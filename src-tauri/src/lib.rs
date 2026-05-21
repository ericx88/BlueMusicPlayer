mod scheduler;

use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Initialize and start scheduler
      let scheduler_state = Arc::new(scheduler::SchedulerState::new(app.handle()));
      app.manage(scheduler_state.clone());
      scheduler::start_scheduler(app.handle().clone(), scheduler_state);

      // Spawn API Sidecar
      let sidecar_command = app.shell().sidecar("api-sidecar").expect("Failed to initialize sidecar");
      let (mut rx, _child) = sidecar_command
        .spawn()
        .expect("Failed to spawn sidecar");
      
      tauri::async_runtime::spawn(async move {
        // Log sidecar output
        while let Some(event) = rx.recv().await {
          if let CommandEvent::Stdout(line) = event {
            println!("Sidecar: {}", String::from_utf8_lossy(&line));
          } else if let CommandEvent::Stderr(line) = event {
            eprintln!("Sidecar: {}", String::from_utf8_lossy(&line));
          }
        }
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        scheduler::get_schedules,
        scheduler::set_schedules
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
