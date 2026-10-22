use tauri::State;

use super::SystemPowerHold;

#[tauri::command]
pub fn power_hold(power: State<'_, SystemPowerHold>) -> bool {
    power.hold()
}

#[tauri::command]
pub fn power_release(power: State<'_, SystemPowerHold>) {
    power.release();
}
