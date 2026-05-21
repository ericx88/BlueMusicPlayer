use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use chrono::Local;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Schedule {
    pub time: String, // "HH:mm"
    pub name: String,
    pub playlist_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScheduleConfig {
    pub schedules: Vec<Schedule>,
}

pub struct SchedulerState {
    pub config_path: PathBuf,
    pub config: Arc<Mutex<ScheduleConfig>>,
}

impl SchedulerState {
    pub fn new(app: &AppHandle) -> Self {
        // Use app config dir
        let config_dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
        if !config_dir.exists() {
            let _ = fs::create_dir_all(&config_dir);
        }
        let config_path = config_dir.join("playlist-schedule.json");

        let config = if config_path.exists() {
            let data = fs::read_to_string(&config_path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or(ScheduleConfig { schedules: vec![] })
        } else {
            let default_config = ScheduleConfig { schedules: vec![] };
            let _ = fs::write(&config_path, serde_json::to_string_pretty(&default_config).unwrap());
            default_config
        };

        Self {
            config_path,
            config: Arc::new(Mutex::new(config)),
        }
    }

    pub async fn save(&self) -> Result<(), String> {
        let config = self.config.lock().await;
        let data = serde_json::to_string_pretty(&*config).map_err(|e| e.to_string())?;
        fs::write(&self.config_path, data).map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn start_scheduler(app: AppHandle, state: Arc<SchedulerState>) {
    tauri::async_runtime::spawn(async move {
        let mut last_triggered_time = String::new();

        loop {
            let now = Local::now();
            let current_time_str = now.format("%H:%M").to_string();

            // Only check once per minute
            if current_time_str != last_triggered_time {
                let config = state.config.lock().await;
                
                for schedule in &config.schedules {
                    if schedule.time == current_time_str {
                        println!("Triggering schedule: {} at {}", schedule.name, schedule.time);
                        let _ = app.emit("switch-playlist", schedule.clone());
                        last_triggered_time = current_time_str.clone();
                        break;
                    }
                }
            }

            tokio::time::sleep(Duration::from_secs(10)).await;
        }
    });
}

#[tauri::command]
pub async fn get_schedules(state: tauri::State<'_, Arc<SchedulerState>>) -> Result<Vec<Schedule>, String> {
    let config = state.config.lock().await;
    Ok(config.schedules.clone())
}

#[tauri::command]
pub async fn set_schedules(schedules: Vec<Schedule>, state: tauri::State<'_, Arc<SchedulerState>>) -> Result<(), String> {
    {
        let mut config = state.config.lock().await;
        config.schedules = schedules;
    }
    state.save().await
}
