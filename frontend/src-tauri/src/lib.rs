use tauri::menu::{MenuBuilder, SubmenuBuilder, PredefinedMenuItem, MenuItemBuilder};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 已有实例运行时，聚焦主窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // 构建中文菜单
            build_menu(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();

    // macOS 应用菜单
    let app_menu = SubmenuBuilder::new(handle, "N1KO MUSIC")
        .item(&PredefinedMenuItem::about(handle, Some("关于 N1KO MUSIC"), None)?)
        .separator()
        .item(&PredefinedMenuItem::services(handle, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(handle, Some("隐藏"))?)
        .item(&PredefinedMenuItem::hide_others(handle, Some("隐藏其他"))?)
        .item(&PredefinedMenuItem::show_all(handle, Some("显示全部"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(handle, Some("退出"))?)
        .build()?;

    // 编辑菜单
    let edit_menu = SubmenuBuilder::new(handle, "编辑")
        .item(&PredefinedMenuItem::undo(handle, Some("撤销"))?)
        .item(&PredefinedMenuItem::redo(handle, Some("重做"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(handle, Some("剪切"))?)
        .item(&PredefinedMenuItem::copy(handle, Some("复制"))?)
        .item(&PredefinedMenuItem::paste(handle, Some("粘贴"))?)
        .item(&PredefinedMenuItem::select_all(handle, Some("全选"))?)
        .build()?;

    // 视图菜单
    let reload_item = MenuItemBuilder::new("刷新")
        .id("reload")
        .accelerator("CmdOrCtrl+R")
        .build(handle)?;
    let fullscreen_item = PredefinedMenuItem::fullscreen(handle, Some("全屏"))?;

    let view_menu = SubmenuBuilder::new(handle, "视图")
        .item(&reload_item)
        .separator()
        .item(&fullscreen_item)
        .build()?;

    // 窗口菜单
    let window_menu = SubmenuBuilder::new(handle, "窗口")
        .item(&PredefinedMenuItem::minimize(handle, Some("最小化"))?)
        .item(&PredefinedMenuItem::maximize(handle, Some("缩放"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(handle, Some("关闭"))?)
        .build()?;

    let menu = MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;

    app.set_menu(menu)?;

    // 处理自定义菜单事件（刷新）
    let handle_clone = handle.clone();
    app.on_menu_event(move |_app, event| {
        let id = event.id().0.as_str();
        if let Some(window) = handle_clone.get_webview_window("main") {
            match id {
                "reload" => {
                    let _ = window.eval("location.reload()");
                }
                _ => {}
            }
        }
    });

    Ok(())
}
