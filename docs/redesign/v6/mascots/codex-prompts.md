# 给 Codex 的出图提示词（单人姿势 + 眨眼帧）

App 里的吉祥物直接用 Codex 渲染图，再在本机抠图（rembg / ISNet，不上传任何图片）。

每条提示词都是完整的：整段发给 Codex，附上它列的参考图（都在本目录），按顺序一张一张出。提示词里的路径相对仓库根目录；Codex 不在仓库根目录跑的话，出完把图挪进本目录。

| 参考图 | 是什么 | 拿来对什么 |
| --- | --- | --- |
| `duo-hero.png` | 两只的合影 | 渲染风格、底色、毛豆的耳机 |
| `nuomi-sheet.png` | 糯米的三视图 | 造型 |
| `maodou-sheet.png` | 毛豆的三视图 | 造型（这张没戴耳机） |
| `expressions.png` | 表情表：上排糯米、下排毛豆，从左到右是笑、闭眼、吃惊、眨眼 | 脸 |

出完先看一眼，不对就在同一个对话里指出来让它重出：

- 全身都在画面里，耳朵、手、脚都没被裁；
- 纯浅灰底，没有地平线、道具、文字、音符、Zzz；
- 和合影是同一只：脸型、眼睛大小和间距、衣服细节都对，毛豆戴着青柠耳机。

## 单人姿势（5 张，发版前要齐）

### 1. `nuomi-wink.png`：糯米眨眼挥手

用在空收藏和其余没指定姿势的空态（`EmptyState` 的默认）。参考图：`duo-hero.png`、`nuomi-sheet.png`、`expressions.png`。

```text
Generate one image and save it as docs/redesign/v6/mascots/nuomi-wink.png

Reference images (attached; also in docs/redesign/v6/mascots/): duo-hero.png for the render style, nuomi-sheet.png for the exact character design, expressions.png for the face.

Character: Nuomi, the white plush bunny from the references: tall upright ears with pink insides, a big round head, large glossy dark-brown eyes, a tiny pink triangle nose, pink cheeks, a round fluffy white tail; mustard-yellow overalls cut as shorts with rolled cuffs, a stitched bib pocket and two cream four-hole buttons on the straps.

Pose: standing with the feet together, body turned slightly to the viewer's left, head tilted a little; winking like the fourth bunny face in the expression sheet (one eye closed in a happy curve, the other open) with a small open smile; one paw raised beside the cheek in a little wave, the other arm relaxed at the side.

Style: match duo-hero.png exactly. Stylized 3D render of a soft plush toy: matte felt and velvet with a fine fabric texture, neat stitching on the clothes, big glossy eyes with white highlights, soft pink blush, chibi proportions. Soft diffuse studio light from the upper left, gentle ambient occlusion, no outlines, no glow. Keep the character design exactly as in the references: same head shape, face, eye size and spacing, colours, proportions and outfit details.

Framing: full body, centred, about 12% empty margin on every side, nothing cropped: ears, paws and feet all inside the frame. Square, 1536×1536.

Background: plain seamless light grey (#EEEEF0) over the whole frame, only a soft contact shadow under the character, no floor line. Nothing else in the picture: no props, no music notes, no "Zzz", no symbols, no text, no logo, no watermark.
```

### 2. `nuomi-sleep.png`：糯米坐着睡着

用在队列空、榜单空、唱片说明空。参考图：`duo-hero.png`、`nuomi-sheet.png`、`expressions.png`。

```text
Generate one image and save it as docs/redesign/v6/mascots/nuomi-sleep.png

Reference images (attached; also in docs/redesign/v6/mascots/): duo-hero.png for the render style, nuomi-sheet.png for the exact character design, expressions.png for the face.

Character: Nuomi, the white plush bunny from the references: tall upright ears with pink insides, a big round head, large glossy dark-brown eyes, a tiny pink triangle nose, pink cheeks, a round fluffy white tail; mustard-yellow overalls cut as shorts with rolled cuffs, a stitched bib pocket and two cream four-hole buttons on the straps.

Pose: sitting on the floor asleep, legs stretched forward with the round feet pointing up, both paws resting in the lap, head tilted to one side, ears relaxed with one ear flopped over; eyes closed like the second bunny face in the expression sheet, a small peaceful smile.

Style: match duo-hero.png exactly. Stylized 3D render of a soft plush toy: matte felt and velvet with a fine fabric texture, neat stitching on the clothes, big glossy eyes with white highlights, soft pink blush, chibi proportions. Soft diffuse studio light from the upper left, gentle ambient occlusion, no outlines, no glow. Keep the character design exactly as in the references: same head shape, face, eye size and spacing, colours, proportions and outfit details.

Framing: full body, centred, about 12% empty margin on every side, nothing cropped: ears, paws and feet all inside the frame. Square, 1536×1536.

Background: plain seamless light grey (#EEEEF0) over the whole frame, only a soft contact shadow under the character, no floor line. Nothing else in the picture: no props, no pillow, no music notes, no "Zzz", no symbols, no text, no logo, no watermark.
```

### 3. `maodou-listen.png`：毛豆闭眼听歌

用在最近播放、统计、口味、推荐（「听了才会有」）。参考图：`duo-hero.png`、`maodou-sheet.png`、`expressions.png`。

```text
Generate one image and save it as docs/redesign/v6/mascots/maodou-listen.png

Reference images (attached; also in docs/redesign/v6/mascots/): duo-hero.png for the render style and the headphones, maodou-sheet.png for the exact character design, expressions.png for the face.

Character: Maodou, the green plush frog from the references: two big round eyes on top of the head (white eyeballs, glossy black pupils), two tiny nostril dots, a wide mouth, pink cheeks, a cream muzzle and chin, round-tipped fingers, long thin legs and big feet with round toe pads; a red-and-cream horizontally striped T-shirt with a red ribbed collar, beige shorts with rolled cuffs. Wearing the lime-green over-ear headphones from duo-hero.png: a thin lime headband arching over the head behind the eyes, round cream ear cups with lime rims on both sides of the head. (maodou-sheet.png shows the frog without headphones; add them.)

Pose: standing and swaying to music, body leaning slightly to one side, one hand pressed to an ear cup, the other arm loose; eyes closed like the second frog face in the expression sheet (green lids with a dark line), a contented closed-mouth smile.

Style: match duo-hero.png exactly. Stylized 3D render of a soft plush toy: matte felt and velvet with a fine fabric texture, neat stitching on the clothes, big glossy eyes with white highlights, soft pink blush, chibi proportions. Soft diffuse studio light from the upper left, gentle ambient occlusion, no outlines, no glow. Keep the character design exactly as in the references: same head shape, face, eye size and spacing, colours, proportions and outfit details.

Framing: full body, centred, about 12% empty margin on every side, nothing cropped: eyes, headphones, hands and feet all inside the frame. Square, 1536×1536.

Background: plain seamless light grey (#EEEEF0) over the whole frame, only a soft contact shadow under the character, no floor line. Nothing else in the picture: no props, no music notes, no "Zzz", no symbols, no text, no logo, no watermark.
```

### 4. `maodou-surprised.png`：毛豆吃惊

用在出错、没找到。参考图：`duo-hero.png`、`maodou-sheet.png`、`expressions.png`。

```text
Generate one image and save it as docs/redesign/v6/mascots/maodou-surprised.png

Reference images (attached; also in docs/redesign/v6/mascots/): duo-hero.png for the render style and the headphones, maodou-sheet.png for the exact character design, expressions.png for the face.

Character: Maodou, the green plush frog from the references: two big round eyes on top of the head (white eyeballs, glossy black pupils), two tiny nostril dots, a wide mouth, pink cheeks, a cream muzzle and chin, round-tipped fingers, long thin legs and big feet with round toe pads; a red-and-cream horizontally striped T-shirt with a red ribbed collar, beige shorts with rolled cuffs. Wearing the lime-green over-ear headphones from duo-hero.png: a thin lime headband arching over the head behind the eyes, round cream ear cups with lime rims on both sides of the head. (maodou-sheet.png shows the frog without headphones; add them.)

Pose: surprised and leaning back a little, both hands raised beside the cheeks with the palms open; eyes wide open and a small round "o" mouth like the third frog face in the expression sheet.

Style: match duo-hero.png exactly. Stylized 3D render of a soft plush toy: matte felt and velvet with a fine fabric texture, neat stitching on the clothes, big glossy eyes with white highlights, soft pink blush, chibi proportions. Soft diffuse studio light from the upper left, gentle ambient occlusion, no outlines, no glow. Keep the character design exactly as in the references: same head shape, face, eye size and spacing, colours, proportions and outfit details.

Framing: full body, centred, about 12% empty margin on every side, nothing cropped: eyes, headphones, hands and feet all inside the frame. Square, 1536×1536.

Background: plain seamless light grey (#EEEEF0) over the whole frame, only a soft contact shadow under the character, no floor line. Nothing else in the picture: no props, no sweat drops, no exclamation marks, no music notes, no symbols, no text, no logo, no watermark.
```

### 5. `maodou-wave.png`：毛豆招手

用在搜索页、乐库和专辑为空、不能浏览的音源（「去搜一搜」）。参考图：`duo-hero.png`、`maodou-sheet.png`、`expressions.png`。

```text
Generate one image and save it as docs/redesign/v6/mascots/maodou-wave.png

Reference images (attached; also in docs/redesign/v6/mascots/): duo-hero.png for the render style and the headphones, maodou-sheet.png for the exact character design, expressions.png for the face.

Character: Maodou, the green plush frog from the references: two big round eyes on top of the head (white eyeballs, glossy black pupils), two tiny nostril dots, a wide mouth, pink cheeks, a cream muzzle and chin, round-tipped fingers, long thin legs and big feet with round toe pads; a red-and-cream horizontally striped T-shirt with a red ribbed collar, beige shorts with rolled cuffs. Wearing the lime-green over-ear headphones from duo-hero.png: a thin lime headband arching over the head behind the eyes, round cream ear cups with lime rims on both sides of the head. (maodou-sheet.png shows the frog without headphones; add them.)

Pose: waving hello: one hand raised high above the shoulder with the fingers spread, the other hand on the hip, feet slightly apart; a big open-mouth smile like the first frog face in the expression sheet.

Style: match duo-hero.png exactly. Stylized 3D render of a soft plush toy: matte felt and velvet with a fine fabric texture, neat stitching on the clothes, big glossy eyes with white highlights, soft pink blush, chibi proportions. Soft diffuse studio light from the upper left, gentle ambient occlusion, no outlines, no glow. Keep the character design exactly as in the references: same head shape, face, eye size and spacing, colours, proportions and outfit details.

Framing: full body, centred, about 12% empty margin on every side, nothing cropped: eyes, headphones, the raised hand and the feet all inside the frame. Square, 1536×1536.

Background: plain seamless light grey (#EEEEF0) over the whole frame, only a soft contact shadow under the character, no floor line. Nothing else in the picture: no props, no music notes, no symbols, no text, no logo, no watermark.
```

## 眨眼帧（可选，2 张）

App 把闭眼图叠在原图上、每隔几秒亮一下，只露出眼睛那一块。Codex 改图常把整张图轻微重画，别处有些出入没关系，处理时只取眼睛；但头的位置和大小不能变。

### 6. `duo-hero-blink.png`：合影眨眼（开屏）

参考图：`duo-hero.png`（要改的那张）、`expressions.png`。

```text
Edit the attached duo-hero.png (the bunny and the frog waving together) and save the result as docs/redesign/v6/mascots/duo-hero-blink.png

The second attachment, expressions.png, is only a reference for how closed eyes look.

Change only the eyes, as if both characters blink: the bunny's eyes become closed-eye lines like the second bunny face in the expression sheet; the frog's eyeballs are covered by green lids with a dark line, like the second frog face, and the eye bumps keep their size and position.

Keep everything else exactly as in the input: pose, framing, size, position, mouths, hands, headphones, lighting, colours, fabric texture and background. Same 1536×1536 size. The result is laid over the original as a blink frame, so nothing else may move.
```

### 7. `maodou-wave-blink.png`：毛豆招手眨眼

等第 5 张定稿再做；第 5 张重出过，这张也要跟着重做。参考图：`maodou-wave.png`（要改的那张）、`expressions.png`。

```text
Edit the attached maodou-wave.png (the frog waving) and save the result as docs/redesign/v6/mascots/maodou-wave-blink.png

The second attachment, expressions.png, is only a reference for how closed eyes look.

Change only the eyes, as if the frog blinks: the eyeballs are covered by green lids with a dark line, like the second frog face in the expression sheet, and the eye bumps keep their size and position.

Keep everything else exactly as in the input: pose, framing, size, position, mouth, hands, headphones, lighting, colours, fabric texture and background. Same 1536×1536 size. The result is laid over the original as a blink frame, so nothing else may move.
```
