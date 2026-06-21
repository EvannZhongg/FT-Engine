# FT Engine User Manual

## 1. Software Overview

FT Engine is a desktop application for electronic judging and scoring. Core capabilities include:

1. Create new matches and configure Free Mode or Tournament Mode.
2. Scan and bind Bluetooth scoring devices.
3. Display each judge's scoring status in real time during a match.
4. Use an overlay window to display scores on top of fullscreen content or a selected window.
5. Save match data and review reports or export detail files after the match.

![](\images\01.png)

---

## 2. Before You Start

Before using the software, make sure the following are ready:

1. Bluetooth is enabled on your computer and can scan judge devices normally.
2. Judge devices are in a connectable state.
3. If you plan to use the overlay window, open the target application or match screen in advance.
4. If you need to import a player list, prepare a `.csv`, `.xlsx`, or `.xls` file.
5. If you need live streaming or screen recording, confirm whether to enable OBS Isolation.


### 2.1 Main Pages in the Software

| Page | Purpose |
| --- | --- |
| Home | Create a new match, view history, continue an existing project, delete a project |
| Top Settings Panel | Language switch, shortcut key setup, OBS Isolation, local data cleanup |
| Pre-Match Setup Wizard | Create project, configure groups, import list, bind devices |
| Scoring Page | Real-time scoring, switch players, reset, open overlay, end match |
| Overlay Window | Display scores and waveform charts over fullscreen or a selected window |
| Reports Page | View converted scores and raw scores, export CSV / ZIP / SRT details |

---

## 3. Top Bar and Global Settings

In non-overlay mode, the top bar is always visible. It contains the brand area, the settings button, and window controls.


### 3.1 Actions Available in the Top Bar

1. Click the settings button in the top-right corner to expand the global settings panel.
2. Click the minimize button to send the main window to the taskbar.
3. Click the maximize button to maximize or restore the window.
4. Click the close button to close the main window. If an overlay window is open, it will also be closed.
5. Double-click a blank area on the top bar to maximize or restore the window.

![](\images\02.png)

### 3.2 Actions Available in the Settings Panel

#### 3.2.1 Language Switching

1. Open the settings panel.
2. In the "Language" dropdown, choose `简体中文`, `English`, or `日本語`.
3. The language switches immediately and is saved locally.

![](\images\03.png)

#### 3.2.2 Reset Shortcut Key Settings

1. Open the settings panel.
2. Click the "Reset Shortcut Key" input box.
3. Press the key combination you want to use, for example `Ctrl+G` or `Ctrl+1`.
4. The software saves the shortcut immediately.

Notes:

1. This is a global shortcut key and is registered on the scoring page.
2. When the scoring page is in "Auto" mode, the shortcut runs the "Next" logic.
3. When "Auto" is disabled on the scoring page, the shortcut runs the "Reset" logic.

![](\images\04.png)

#### 3.2.3 OBS Isolation

1. Open the settings panel.
2. In "OBS Isolation", select "Enable" or "Disable".

What it does:

1. When enabled, the main window content is not captured by OBS.
2. The overlay window is not affected and can still be used for stream overlays.

Use case:

1. You only want viewers to see the overlay score display, not the control interface.

![](\images\05.png)

#### 3.2.4 Delete All Local Data

1. Open the settings panel.
2. Click "Delete All Local Data".
3. Confirm again in the confirmation dialog.
4. The software deletes saved match records, app settings, and logs on this machine, then restarts automatically.

Important:

1. This operation cannot be undone.
2. Deleted data includes local `app_settings.json`, the `match_data` directory, and the `logs` directory.
3. If deletion fails, close the app and try again.

![](\images\06.png)

---

## 4. Home Page

The Home page is the default entry page. It is mainly used to start a new match and manage historical projects.


### 4.1 Actions Available on the Home Page

1. Click "New Match" to enter the pre-match setup wizard.
2. Click "History" to open the historical project list.

![](\images\07.png)

### 4.2 Create a New Match

1. Click the "New Match" card.
2. The software first clears the current frontend cache state.
3. Then it enters Step 1 of the pre-match setup wizard.

Best for:

1. Starting a completely new match.
2. Avoiding reuse of groups, player lists, and device bindings from old projects.


### 4.3 History List

After clicking "History", a historical project list dialog appears.


For each history record, the following actions are available:

1. `View`
   Purpose: Open this project's report page directly.
2. `Continue`
   Purpose: Load this project's configuration and return to the pre-match setup wizard, so you can continue the match or rebind devices.
3. `Delete`
   Purpose: Delete all historical data for this project.

![](\images\08.png)

Notes:

1. "Continue" restores the project name, mode, groups, player list, and saved judge bindings.
2. "Delete Project" cannot be undone.
3. After returning to Home from the report page, the History dialog opens again by default for quick review of other projects.

---

## 5. Pre-Match Setup Wizard

The pre-match setup wizard has 2 to 3 steps, depending on whether you choose Free Mode or Tournament Mode.


### 5.1 Step 1: Basic Settings

This page is used to create a project and select the match mode.

![](\images\09.png)

#### 5.1.1 Actions Available

1. Enter the match name in "Project Name".
2. Choose the match mode:
   `Free Mode` or `Tournament`.
3. If Free Mode is selected, enter the "Number of Judges".
4. Click "Next" to continue.
5. Click "Cancel" to return to Home.


#### 5.1.2 Difference Between the Two Modes

**Free Mode**

1. No need to preconfigure multiple groups.
2. The system automatically creates a default group named `Free Mode`.
3. Suitable for temporary testing, quick scoring, or adding players on the fly.
4. During the match, after all current players are completed, you can continue adding players.

**Tournament Mode**

1. Proceeds to the next step: "Group Management".
2. Suitable for official matches with clear groups, player lists, and judge count.
3. After all players are completed, you can restart from the first player.

#### 5.1.3 Usage Notes

1. The project name is used to generate the project directory. Use a clear, identifiable name.
2. In Free Mode, the number of judges directly determines how many binding cards appear later.
3. If you enter from "History -> Continue", this page is auto-filled with the existing configuration.

---

### 5.2 Step 2: Group Management

This page appears only in Tournament Mode. It is used to configure groups, judge count, and player lists.

![](\images\10.png)

#### 5.2.1 Actions in the Left Group List

1. View all created groups.
2. Click a group to switch the editor on the right.
3. Click "Add Group" to create a new group.

![](\images\11.png)

#### 5.2.2 Actions in the Right Configuration Panel

1. Edit the group name.
2. Set the number of judges for this group.
3. Enter the player list in the text box, one player per line.
4. Click "Import List" to import names from an Excel or CSV file.
5. When there is more than one group, you can delete the current group.

![](\images\12.png)

#### 5.2.3 Player List Import Workflow

1. Click the "Import List" button.
2. Select a `.csv`, `.xlsx`, or `.xls` file.
3. The software reads the first worksheet and detects all non-empty columns.
4. If multiple candidate columns are detected, a "Select Column to Import" dialog appears.
5. Choose the column that contains player names.
6. Click "Confirm Import".
7. Imported names are appended to the current group's player list text box.

![](\images\13.png)

#### 5.2.4 Save and Proceed

1. Click "Save and Next".
2. The software splits each group's list by line breaks into formal player lists.
3. Then it enters the device binding page.


#### 5.2.5 Usage Notes

1. Empty lines in the text box are ignored automatically.
2. Use clear group names, because they are used directly in reports.
3. During import, the software reads non-empty values only from the selected column.
4. If the current project is opened via History Continue, existing groups and lists are auto-filled.

---

### 5.3 Step 3: Device Binding

This page is used to scan devices, set judge names, choose single-device or dual-device mode, and bind devices to judge slots.

![](\images\14.png)

#### 5.3.1 Actions at the Top of the Page

1. Check the current scanning status.
2. View the number of discovered devices.
3. Click "Device Notes Settings" to add notes for devices.
4. Click "Refresh Devices" to rescan Bluetooth devices.
5. In Tournament Mode, switch which group to start.

![](\images\15.png)

#### 5.3.2 Actions in Each Judge Card

1. Edit the judge display name.
2. Choose mode:
   `Single-device` or `Dual-device`.
3. Select the primary device.
4. In dual-device mode, select a secondary device.

![](\images\16.png)

Notes:

1. A device already assigned to another judge does not appear again in dropdown lists.
2. When switching back to single-device mode, the secondary device is cleared automatically.
3. In single-device mode, the software shows `+`, `-`, and total score for that device.
4. In dual-device mode, the software receives data from both primary and secondary devices.
5. Dual-device mode additionally shows "Key Deduction".
6. Key-deduction calculation in reports applies only to dual-device judges.


#### 5.3.4 Device Notes Settings

After clicking the top tab button, a "Device Notes Settings" dialog opens.

Available actions:

1. View each scanned device's original name and address.
2. Enter a custom note for each device.
3. Click "Save".

Effect after saving:

1. Notes are saved to global settings.
2. Device dropdowns display as "Note (Original Name)" first.
3. Notes are global, not limited to the current project.

![](\images\17.png)

#### 5.3.5 Permanently Rename Bluetooth Device

When some device notes are changed, the software shows a confirmation dialog: "Permanently Rename Device Name".

Available actions:

1. Check the items you want to write to hardware Bluetooth names.
2. Click "Write Selected Devices" to permanently write notes to hardware Bluetooth names.
3. Click "Not Now" to keep local notes only without changing hardware names.

Important:

1. Even if permanent renaming fails, local notes are still kept.
2. Only currently discoverable devices can be permanently renamed.


#### 5.3.6 Start Match

1. Confirm that each judge's name, mode, primary device, and secondary device are set correctly.
2. Click "Start Match".
3. The software saves current group configuration and enters device connection status.


---

### 5.4 Device Connection Status Dialog

After clicking "Start Match", a "Connecting devices..." dialog appears.

You can see:

1. Each judge's name.
2. Primary device connection status label.
3. Secondary device connection status label in dual-device mode.

Possible statuses:

1. `waiting`
2. `connecting`
3. `connected`
4. `error`

#### 5.4.1 Actions in the Dialog

1. If devices connect successfully, the software enters the scoring page automatically.
2. If not all devices are connected after 8 seconds, a "Connection timeout" message appears.
3. You can click "Cancel" to stop starting this match.
4. You can also click "Force Enter" to open the scoring page immediately.

Recommendations:

1. Before an official match, ensure all devices reach `connected` whenever possible.
2. "Force Enter" is suitable for debugging, testing, or temporarily skipping some devices.

---

## 6. Scoring Page

The scoring page is the main control page during a match. It is used to monitor real-time scores, switch players, reset scores, open the overlay, and end the match.

![](\images\18.png)

### 6.1 Top Left: End Match

1. Click the "End" button.
2. The software sends a stop-match command to the backend.
3. All judge connections are disconnected.
4. The page returns to Home.


Notes:

1. Historical data already written is not lost when you click "End".
2. To continue the same project after ending, reopen it from Home History.

### 6.2 Top Center: Current Group and Player Switching

The center area shows the current group and current player.

Available actions:

1. View the current group name.
2. Use the left arrow to switch to the previous player.
3. Use the right arrow to switch to the next player.
4. Use the dropdown to directly select any player.
5. Completed players show a check mark in the dropdown.

![](\images\19.png)

Notes:

1. When switching players manually, the software synchronizes the current match context.
2. After switching players, the software performs one reset operation.
3. In Free Mode, after the last player, pressing "Next" again automatically adds `Player N`.

### 6.3 Top Right: Auto, Overlay, Next, Reset

#### 6.3.1 Auto Toggle

1. Click the "Auto" button to enable or disable it.

When enabled:

1. "Next" saves the current player's score and switches directly to the next player.
2. The global shortcut performs the same logic.

When disabled:

1. Clicking "Next" shows a confirmation dialog first.
2. The global shortcut switches to "Reset".


#### 6.3.2 Start Overlay Window

1. Click the "Overlay" button.
2. In the popup, choose a target window or "Fullscreen Mode".
3. Click "Start Overlay".
4. The software opens an independent transparent overlay window.

![](\images\20.png)

Notes:

1. The software reads current system window titles.
2. If a specific window is selected, the overlay opens at that window's current position and size.
3. In current code, after opening, the overlay does not continuously follow target window movement. If the target window moves, drag the overlay manually.

#### 6.3.3 Next

1. Click the "Next" button.
2. The current player is marked as "scoring completed".
3. The software searches for the next unfinished player in the current group.
4. After finding one, it switches to that player and resets automatically.

After all players are completed:

1. In Free Mode, a new player is added automatically.
2. In Tournament Mode, an "All Completed" dialog appears.


#### 6.3.4 Reset

1. Click the "Reset" button.
2. Scores for all current judges are reset to 0.

If "Skip confirmation" is not enabled:

1. A confirmation dialog appears.
2. You can check "Do not ask again".


### 6.4 Judge Score Cards

Each score card in the middle area represents one judge.

Each card shows:

1. Judge name.
2. Primary device connection status indicator.
3. Secondary device status indicator in dual-device mode.
4. Current total score.
5. Current `+` score and `-` score.
6. "Key Deduction" in dual-device mode.

![](\images\21.png)

Indicator color notes:

1. Green: connected.
2. Other colors: waiting, connecting, or error.

### 6.5 All Completed Dialog

When all players in the current group are completed, an "All Completed" dialog appears.

![](\images\22.png)

Available actions:

1. `Save and Exit`
   Purpose: End the match and return to Home.
2. `Continue`
   In Free Mode: continue and add a new player.
   In Tournament Mode: restart scoring from the first player.

Notes:

1. In Tournament Mode, "Continue" is suitable for rescoring the full group.
2. In Free Mode, "Continue" is better for adding players on site.

---

## 7. Overlay Window

The overlay window is an independent window used to display scoring content over match footage. It is suitable for OBS, screen projection, or venue display screens.

![](\images\23.png)

### 7.1 Basic Characteristics

1. Always on top by default.
2. Does not show a taskbar icon by default.
3. Mouse click-through is enabled by default to avoid blocking operations on the target screen.
4. When the mouse moves to the top dock area or a card, it enters interactive mode automatically.

### 7.2 Actions in the Top Dock Bar

Move the mouse to the top of the overlay window to show the control dock.

![](\images\24.png)

Available actions:

1. View current player name.
2. Click `Next` to switch to the next player.
3. Click `R` to reset current scores.
4. Click the waveform button to show or hide the waveform chart.
5. Click the settings button to open the overlay settings panel.
6. Click the close button to close the overlay window.

Notes:

1. Clicking `Next` also marks the current player as completed.
2. The dock bar can be dragged left and right, but its Y position is fixed at the top.

### 7.3 Actions on Judge Cards

Each judge card can be dragged independently.


You can also:

1. Drag the bottom-right resize handle to resize judge cards.
2. When one judge card is resized, all judge cards sync to the same size.
3. In the score-font area, hold the mouse and scroll the wheel to scale fonts for all judge cards at once.


### 7.4 Waveform Chart

The overlay window supports a waveform chart component.


Waveform chart characteristics:

1. It starts recording after the current player first gets a non-zero score.
2. X-axis is time, Y-axis is score.
3. Each judge corresponds to one line.
4. Switching players resets the waveform chart automatically.
5. Resetting all judge scores to zero also resets the waveform chart.
6. The waveform card itself is draggable and freely resizable.

### 7.5 Overlay Settings Panel

Click the settings button in the dock bar to open the settings panel.


Available settings:

1. `Display Mode`
   Options:
   `Breakdown (+ / -)`, `Total Only`, `Combined`, `Real-time (Combo)`.
2. `Opacity`
   Use the slider to adjust background transparency.
3. `Background Color`
   Customize card background color.
4. `Restore Defaults`
   Restore overlay styles to default values.
5. `Close`
   Collapse the settings panel.


Description of the four display modes:

1. `Breakdown (+ / -)`: shows separate positive and negative components.
2. `Total Only`: shows only total score, better for large-screen display.
3. `Combined`: shows total score with a simplified breakdown.
4. `Real-time (Combo)`: shows accumulated score changes in a short period, suitable for dynamic subtitles or instant feedback.

Notes:

1. Overlay style settings are saved locally and reused next time.
2. In the current implementation, font scaling is global and not separated by individual judge cards.

---

## 8. Reports Page

The reports page is used to view historical project results, calculate converted scores, view raw scores, and export CSV, logs, and subtitle files.

![](\images\25.png)

### 8.1 Left Group Sidebar

The left side shows all groups under the current project.

Available actions:

1. Click any group to switch current report content.
2. Click "Back to List" to return to Home History state.

> Image placeholder: Group list on reports page

### 8.2 Top Toolbar

The top toolbar provides different actions based on the current view.


Available actions:

1. `Advanced Settings`
   Shown only in the Converted Score view.
2. `Export Details`
   Export player logs and subtitle files as a ZIP package.
3. `Table CSV`
   Export the CSV for the current table view.
4. `Converted Score / Raw Score`
   Switch report view mode.

### 8.3 Converted Score View

The Converted Score view shows:

1. Ranking.
2. Player name.
3. Converted score from each judge.
4. Key Deduction column.
5. Final score.

#### 8.3.1 Conversion Rules

Based on current code logic, the conversion works as follows:

1. Find each judge's highest raw score in the current group.
2. For each player and each judge, convert the score with:
   `player_raw_score / judge_max_score x ratio`
3. The default ratio is `60`.
4. Final score is the average of all judges' converted scores.
5. If "Show Key Deduction" is enabled, the final score is further reduced by the standard key deduction.

#### 8.3.2 Key Deduction Rules

Based on current implementation:

1. Only key deductions from dual-device judges are counted.
2. The "majority wins" rule is used.
3. If multiple deduction values have the same count, the larger value is used.

### 8.4 Raw Score View

The Raw Score view shows:

1. Each player's total score from each judge.
2. Corresponding `+` and `-` values.
3. If key deduction exists, it is also shown in the cell.
4. The player's raw average score.

![](\images\26.png)

### 8.5 Advanced Settings

In Converted Score view, click "Advanced Settings" to open the advanced settings dialog.

> Image placeholder: Advanced settings dialog

Available actions:

1. Edit `Ratio (%)`.
2. Enable or disable `Show Key Deduction`.
3. Click "OK" to save current display behavior.

Notes:

1. "Show Key Deduction" is saved as a local preference per project.
2. When reopening reports for the same project, the last key-deduction display state is restored automatically.

### 8.6 Export Details

Click "Export Details" to open the "Export Score Details" dialog.


Available actions:

1. Select players to export.
2. Use "Select All" to select all players quickly.
3. Choose export formats:
   `CSV (Logs)`, `SRT (Subtitles)`.
4. If `SRT` is selected, choose an SRT mode:
   `Total Score`, `Positive / Negative`, `Real-time Combo`.
5. Click "Download ZIP".

Export result notes:

1. The software downloads a ZIP package named `Details_GroupName.zip`.
2. Files in the ZIP are organized by `Group / Player / Judge`.
3. `CSV (Logs)` files contain time-series logs.
4. `SRT` files are suitable for subtitle overlay or post-production.

### 8.7 Export Table CSV

Click "Table CSV" to download the CSV for the current view directly.

Rules:

1. In `Converted Score` view, it exports ranking, converted scores, key deduction, and final score.
2. In `Raw Score` view, it exports player data, per-judge raw details, and average score.

---

## 9. Continue, View, and Delete Historical Projects

This section supplements the Home History list and is useful for daily project management.

### 9.1 Continue a Project

Path:

1. Home.
2. History.
3. Locate target project.
4. Click "Continue".

What happens after continuing:

1. The software loads this project's `config.json`.
2. It enters the pre-match setup wizard.
3. Existing groups, player lists, judge count, and bindings are backfilled.
4. You can modify settings and start the match again.

### 9.2 View Reports

Path:

1. Home.
2. History.
3. Locate target project.
4. Click "View".

The software opens this project's report page directly.

### 9.3 Delete a Project

Path:

1. Home.
2. History.
3. Locate target project.
4. Click the trash button.
5. Confirm deletion in the confirmation dialog.

What happens after deletion:

1. The project directory is permanently deleted.
2. Local report preferences for that project are also deleted.

---

## 10. Files and Data

To help new users understand where data is stored, this section provides a concise explanation.

### 10.1 Project Data Contents

Each project stores:

1. Project config file `config.json`.
2. Group directories.
3. Raw CSV record files for each player and each judge.

Typical structure:

```text
match_data/
  20260320_120000_My Match/
    config.json
    Group A/
      Player 1_Ref1.csv
      Player 1_Ref2.csv
      Player 2_Ref1.csv
```

### 10.2 Settings File Contents

Global settings store:

1. Language.
2. Shortcut key.
3. Whether to skip confirmations.
4. Device notes.
5. OBS Isolation switch.
6. Report preferences by project.

### 10.3 Data Storage Locations

Based on current code logic:

**Development Environment**

1. Data is stored in the project root by default.
2. For example, `app_settings.json` and `match_data` in the current project.

**Packaged Production Environment**

1. On Windows, usually at `%APPDATA%/FT Engine/`.
2. On macOS, usually at `~/Library/Application Support/FT Engine/`.

### 10.4 Export File Types

| Export Type | Content |
| --- | --- |
| Report CSV | Current table view content |
| ZIP Details Package | Player log CSV files and SRT subtitle files |
| Log CSV | Time-series score changes |
| SRT Total Score | Total score changes |
| SRT Breakdown | `+ / -` changes |
| SRT Real-time Combo | Short-period accumulated changes |

---

## 11. Recommended Workflow for New Users

If this is your first time using the software, follow the process below.

### 11.1 Quick Start Flow

1. Open the software.
2. In top settings, confirm language, shortcut key, and OBS Isolation needs.
3. Return to Home and click "New Match".
4. In Basic Settings, choose a match mode.
5. If using Tournament Mode, complete group and player list configuration.
6. Enter Device Binding, scan devices, and assign them.
7. Enter clear names for each judge.
8. Start the match and wait for device connection to complete.
9. Complete scoring and player switching on the scoring page.
10. If live display is needed, open the overlay window.
11. After the match, open reports from History to review and export data.


---

## 12. Usage Details and Notes

### 12.1 Bluetooth and Device Notes

1. If scanning reports "Bluetooth is off or unavailable", check computer Bluetooth first.
2. Scanning results are sorted by RSSI, so stronger-signal devices appear earlier.
3. Device notes are stored globally, not per project.
4. Permanent rename is optional, not required.

### 12.2 Match Flow Notes

1. When switching players, the software synchronizes match context and resets current scores.
2. Free Mode is better for flexible on-site usage. Tournament Mode is better for formal project management.
3. The "Auto" switch on the scoring page changes shortcut behavior. This is the most important detail during real use.

### 12.3 Overlay Notes

1. Overlay is click-through by default to avoid blocking operations in the source window.
2. Dragging and settings are available only when the mouse is over the top dock area or card area.
3. Judge card size is linked: changing one card applies to all.
4. The waveform chart is an independent card and can be dragged and resized separately.

### 12.4 Data Safety Notes

1. Deleting a project removes only that project's data.
2. Deleting local data removes all projects, all settings, and all logs.
3. After a match, check History to confirm project data is created before further organization or export.


![](\images\icon.png)