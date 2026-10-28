"""Codex 渲染原图 → App 里的透明底吉祥物（WebP）。全程在本机跑，不上传任何图片。

    python cutout.py <原图.png> <输出.webp> <输出宽度> [--blink <闭眼编辑图.png> <眨眼帧输出.webp>]

做的事：
  1. 抠图：rembg 的 ISNet（isnet-general-use）。模型放在 $U2NET_HOME（默认 ~/.u2net）。
     抠图会把和白底很像的白毛 / 眼白抠成半透明（深色底上发灰）：被主体整圈包住、颜色又不是底色的洞补成实心。
  2. 清残底：半透明、颜色又几乎就是底色的像素直接透明（耳机头梁里那种夹缝）。
  3. 去底色污染：半透明边缘按 C = a·F + (1-a)·B 反解前景色，深色底上不出灰白描边。
  4. 保留原图真实的落地阴影：只认比局部底色（主体外拟合的三次曲面）暗的地方，只留在下半身附近、往外淡掉——
     原图的底本身是越往下越暗的渐变，拿整张的平均底色比，整片地面都会变成一块灰。
  5. 裁到内容加一点边，缩到指定宽度，导出 WebP。
  6. 眨眼帧（可选）：闭眼编辑图和原图逐像素比，只留下眼睛那几块，羽化边缘，
     用和原图完全相同的裁切与缩放导出。App 把它叠在原图上、每隔几秒亮 120ms。
     Codex 改图会把整张轻微重画一遍（毛边、纹理处处有细小出入）：先按「变化很大」的连通块找出眼睛
     （只留面积不小于最大一块 15% 的块），眨眼帧只在这些眼睛框里取，别处一律不进——不然眨眼时全身跟着闪。

依赖：pip install "rembg[cpu]" pillow numpy scipy（scipy 随 rembg 一起装上）
"""
import sys

import numpy as np
from PIL import Image, ImageFilter
from rembg import new_session, remove
from scipy import ndimage as ndi

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def load_rgb(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255


def matte(path, session):
    cut = remove(Image.open(path).convert('RGB'), session=session, alpha_matting=False, post_process_mask=False)
    return np.asarray(cut.convert('RGBA')).astype(np.float32)[..., 3] / 255


def background_colour(rgb):
    edges = [rgb[:8], rgb[-8:], rgb[:, :8], rgb[:, -8:]]
    return np.median(np.concatenate([e.reshape(-1, 3) for e in edges]), axis=0)


def dilate(mask, size):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(size))) / 255


def blur(mask, radius):
    return np.asarray(Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))) / 255


def fill_holes(rgb, alpha, bg, min_colour_dist=0.06):
    """被主体整圈包住、却只给了半透明的洞：颜色明显不是底色的（白毛、眼白——和白底太像，抠图没分清）补成实心；
    颜色就是底色的（耳机头梁和头之间、叉腰的胳膊和身体之间）是真空隙，保持透明"""
    solid = alpha > 0.5
    lab, k = ndi.label(ndi.binary_fill_holes(solid) & ~solid)
    out = alpha.copy()
    for j in range(1, k + 1):
        m = lab == j
        d = float(np.linalg.norm(rgb[m] - bg, axis=-1).mean())
        if d > min_colour_dist or m.sum() < 80:   # 几个像素的小洞不可能是真空隙（手指缝都比它大）
            ys, xs = np.where(m)
            print('  filled hole: %d px at x %d-%d y %d-%d (colour dist to background %.3f)' % (m.sum(), xs.min(), xs.max(), ys.min(), ys.max(), d))
            # 连同洞外那圈 0.5–0.98 的半透明一起补实（只补到 0.5 会在眼白上留一圈锯齿灰边）：从洞往外顺着半透明长，最多 25px
            near = ndi.distance_transform_edt(~m) < 25
            grow = ndi.binary_propagation(m, mask=m | ((alpha < 0.98) & near))
            out = np.where(ndi.binary_dilation(grow, iterations=1), 1.0, out)
    # 收尾：离真背景（外圈 + 留下来的真空隙）6px 以外不该有半透明——主体内部一律实心，挨着背景的抗锯齿边照旧
    interior = ndi.distance_transform_edt(out > 0.5) > 6
    return np.where(interior, 1.0, out)


def background_model(lum, alpha):
    """原图的底不是纯色（越往下越暗的渐变）：在主体外面拟合一个三次曲面当局部底色；比它暗很多的点（阴影）迭代剔掉"""
    h, w = lum.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) / max(h, w)
    X = np.stack([np.ones_like(xx), xx, yy, xx * xx, xx * yy, yy * yy, xx ** 3, xx * xx * yy, xx * yy * yy, yy ** 3], -1).reshape(-1, 10)
    sel = np.flatnonzero(~ndi.binary_dilation(alpha > 0.02, iterations=24).ravel())[::7]
    for _ in range(3):
        coef, *_ = np.linalg.lstsq(X[sel], lum.ravel()[sel], rcond=None)
        resid = lum.ravel()[sel] - X[sel] @ coef
        sel = sel[resid > -0.015]
    return (X @ coef).reshape(h, w)


def compose(rgb, alpha, bg):
    # 残底
    dist = np.linalg.norm(rgb - bg, axis=-1)
    alpha = np.where((alpha < 0.9) & (dist < 0.035), 0, alpha)
    # 去底色污染
    safe = np.clip(alpha, 1e-3, 1)[..., None]
    fg = np.clip((rgb - (1 - safe) * bg) / safe, 0, 1)
    fg = np.where(alpha[..., None] > 0.98, rgb, fg)
    # 真实的落地阴影：只认比「局部底色」暗的地方（整片地面的渐变不算），并且只留在主体下半身附近，往外淡掉
    h = rgb.shape[0]
    lum = rgb @ LUMA
    bgm = background_model(lum, alpha)
    dark = np.clip((bgm - lum) / np.clip(bgm, 1e-3, None), 0, 1)
    ys = np.where((alpha > 0.5).any(1))[0]; top, bottom = ys.min(), ys.max()
    rows = np.clip((np.arange(h)[:, None] - (top + 0.55 * (bottom - top))) / (0.2 * (bottom - top)), 0, 1)
    near = np.exp(-ndi.distance_transform_edt(alpha < 0.5) / (0.05 * h))
    shadow = blur(np.clip(dark * 2.4, 0, 0.55) * (1 - dilate(alpha, 5)) * rows * near, 2)
    shade = np.array([0.06, 0.07, 0.09], dtype=np.float32)
    out_a = alpha + shadow * (1 - alpha)
    out_rgb = (fg * alpha[..., None] + shade * (shadow * (1 - alpha))[..., None]) / np.clip(out_a, 1e-4, 1)[..., None]
    return np.dstack([np.clip(out_rgb, 0, 1), out_a])


def crop_box(alpha, margin_ratio=0.03):
    h, w = alpha.shape
    ys, xs = np.where(alpha > 0.02)
    m = int(margin_ratio * max(h, w))
    return (max(0, xs.min() - m), max(0, ys.min() - m), min(w, xs.max() + m), min(h, ys.max() + m))


def export(rgba, box, width, path):
    img = Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA').crop(box)
    img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    img.save(path, 'WEBP', quality=92, method=6)
    return img.size


def eye_boxes(diff, subject_alpha):
    """找眼睛：变化很大（>0.2）的连通块当种子（面积不小于最大一块的 15%），再顺着中等变化（>0.05）长成整只眼睛、补实。
    只用种子不够：白眼白和闭上的绿眼皮亮度差不到 0.2，眼白外圈会漏在框外，眨眼时透出一道白月牙。
    返回整只眼睛（外扩 8px 留羽化）的掩码和外框；离种子 80px 以外的变化（Codex 重画的毛边）不会被长进来"""
    big = (diff > 0.2) & (subject_alpha > 0.5)
    lab, k = ndi.label(ndi.binary_dilation(big, iterations=6))
    if not k:
        return np.zeros_like(diff, dtype=bool), []
    sizes = ndi.sum(big, lab, range(1, k + 1))
    seed = np.isin(lab, [j + 1 for j in range(k) if sizes[j] >= 0.15 * sizes.max()])
    near = ndi.distance_transform_edt(~seed) < 80
    eyes = ndi.binary_fill_holes(ndi.binary_propagation(seed, mask=seed | ((diff > 0.05) & near & (subject_alpha > 0.5))))
    mask = ndi.binary_dilation(eyes, iterations=8)
    elab, _ = ndi.label(mask)
    boxes = [(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop) for sl in ndi.find_objects(elab)]
    return mask, boxes


def blink_overlay(base_rgb, blink_rgb, subject_alpha):
    """眼睛框里整块换成闭眼图（只在框外圈羽化）：按「变了多少」取透明度会在眼眶边上半透明，透出原来睁眼的那一圈"""
    diff = np.abs(blur(base_rgb @ LUMA, 1.5) - blur(blink_rgb @ LUMA, 1.5))
    eyes, boxes = eye_boxes(diff, subject_alpha)
    print('  blink: eye boxes', boxes, '| changed px outside them (ignored): %.2f%%' % (100 * ((diff > 0.06) & ~eyes).mean()))
    alpha = blur(eyes.astype(np.float32), 4) * subject_alpha
    return np.dstack([blink_rgb, alpha])


def main(argv):
    src, out, width = argv[1], argv[2], int(argv[3])
    session = new_session('isnet-general-use')
    rgb = load_rgb(src)
    bg = background_colour(rgb)
    alpha = fill_holes(rgb, matte(src, session), bg)
    rgba = compose(rgb, alpha, bg)
    box = crop_box(rgba[..., 3])
    print(out, export(rgba, box, width, out))
    if '--blink' in argv:
        i = argv.index('--blink')
        blink_src, blink_out = argv[i + 1], argv[i + 2]
        blink_rgb = load_rgb(blink_src)
        if blink_rgb.shape != rgb.shape:
            blink_rgb = np.asarray(Image.open(blink_src).convert('RGB').resize(rgb.shape[1::-1], Image.LANCZOS)).astype(np.float32) / 255
        print(blink_out, export(blink_overlay(rgb, blink_rgb, alpha), box, width, blink_out))


if __name__ == '__main__':
    main(sys.argv)
