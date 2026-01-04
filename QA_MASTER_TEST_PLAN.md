### Notes
ODBE

- [x]  Ethe ODBE USERS you made
- [x]  In the odbe user should be able to press enter to accept a building number without it advancing to the next section
- [x]  Can not edit saved departments in the ODBE
- [x]  can not edit saved useres
- [x]  Theme Modal does not update its preview based on the preset
- [x]  When you change pages on the ODBE on the theme palette it will revert back to the base palette every time instead of saving your selection when navigating to each page.

## Authentication and Access

- [x]  The contact details sign in Page does not respect the palette.
- [x]  make the prodile icon Letter bigger also use the first and last initial

# Seed Wokflow.

- [ ]  Work

~~Setup Wizard (Onboarding)~~

- [x]  Open /setup when setup is required; verify step gating and progress list.
- [x]  Business step: save business name/type; verify success and editiable state
- [x]  Buildings step: add building and rooms; verify save and list display.
- [x]  Buildings step: attempt save with missing building/rooms; verify error.
- [x]  Departments step: add department and optional divisions; verify save and list display.
- [x]  Departments step: attempt save with invalid name; verify error.
- [x]  Users step: create user with role assignments; verify success and list update.
- [x]  Users step: create default accounts; verify credentials list appears.
- [x]  Users step: clear all accounts; verify warning and data cleared.
- [x]  Users step: remember credentials for post-setup login; verify used on completion.
- [x]  Theme step: select base palette; verify preview updates.
- [x]  Theme step: create new theme; verify it appears and is selected.
- [x]  Theme step: apply preset; verify applied and saved.
- [x]  Completion step: verify readiness list and missing admins warning.
- [x]  Complete setup; verify redirect to home and setup no longer required.

## Authentication and Access

- [x]  Sign up with valid username, email, password; verify success and auto-login attempt.
- [x]  Sign up with existing email/username; verify error handling.
- [x]  Sign in with username; verify redirect to callback URL or home.
- [x]  Sign in with email; verify redirect to callback URL or home.
- [x]  Sign in with invalid credentials; verify error message.
- [x]  Access protected page while signed out; verify redirect to login with callback URL.
- [x]  Use Account menu to sign out; verify redirect to login.
- [x]  Verify users without admin capability see “no access” in Admin panel.

## Profile Setup

- [x]  After signup, complete profile creation and return to callback URL.
- [x]  Verify profile form pre-fills email from session when available.
- [x]  Validate phone formatting and error for < 10 digits.
- [x]  Submit profile with missing required fields; verify validation message.
- [x]  Submit profile with valid data; verify save and redirect.
- [x]  Revisit profile creation when profile exists; verify form pre-populated.

## Seeding Workflow

- [x]  Open Admin > Database; verify seed panel loads with mode options (Full, Workspace, Events, Revert).
- [x]  Events mode: verify error if workspace not initialized.
- [x]  Full mode: run with default count (~420); verify success, logs, and historical events spanning 7 years.
- [x]  Full mode: verify events include Zendesk tickets, hour logs, attendees, and varied properties.
- [ ]  Workspace mode: run seed; verify business, buildings, departments, users created; no events.
- [ ]  Workspace mode: run again; verify idempotent (logs show "already exists" messages).
- [ ]  Events mode: set count = 0; verify no events created.
- [ ]  Events mode: set count = 15; verify 15 events in next 90 days with existing users.
- [ ]  Department targets: add specific department/division counts; verify events created for those scopes.
- [ ]  Faker seed: set seed value; run twice; verify deterministic data (identical results).
- [ ]  Revert mode: enter confirmation; verify all workspace data removed and setup reset.
- [ ]  Revert mode: run on clean database; verify "already clean" message.
- [ ]  Verify event count validation (0-10000) and Faker seed validation (numeric).
- [ ]  Verify seeded events use real buildings/rooms and have realistic times and properties.
- [ ]  Verify seed logs display during operation and show detailed progress.

## Navigation and Layout

- [x]  Sidebar: navigate Home, Tickets, Calendar, Admin, Settings.
- [x]  Verify Global Search appears only when signed in.
- [x]  Verify layout hides sidebar on /login, /signup, /setup.

## Global Search

- [x]  Search by event code; verify navigation to calendar with event focused.
- [x]  Search by Zendesk number; verify navigation to calendar with event focused.
- [x]  Search invalid identifier; verify “Ticket not found”.
- [x]  Submit empty search; verify “Enter a ticket identifier”.

## Calendar - Views and Navigation

- [x]  Switch between day, 3-day, work week, week, and month views (desktop).
- [x]  Navigate previous/next in each view; verify date changes correctly.
- [x]  Use Today button; verify it returns to current date.
- [x]  Change selected date via sidebar mini calendar (desktop).
- [x]  On mobile, change view and date using mobile toolbar and date header.
- [x]  On mobile, change view and date using mobile mini calandar and date header.
- [x]  on desktop change view switch to other pages  and ensure that the calendar view stays constant
- [x]  Month view: select a day; verify it switches to week view.

## Calendar - Calendar Management & Visibility

- [x]  Team calendars appear before personal calendars in the sidebar list.
- [x]  Toggle a team calendar off; verify events disappear from the grid and agenda list.
- [x]  Toggle multiple calendars on/off; verify the visible set persists on refresh.
- [x]  Mini calendar list scrolls smoothly without showing a scrollbar; verify mouse wheel scrolls the list.
- [x]  When calandar changes colre it will chnage the event colors
- [x]  Personal calendar auto-names as "First L. Personal Calendar #N" and can be edited.
- [x]  Managers/admins can see personal calendars in scope; employees only see their own personal calendars.
- [x]  Administrators managers and Co admins should be able to remove calendars,

## Multi-Calendar Event Placement

- [x]  Create event with multiple calendars selected; verify duplicates appear on each selected calendar.
- [x]  Create event with no calendars selected; verify save is blocked with a clear error.
- [x]  Remove a selected calendar chip in the modal; verify it is removed from the target list.
- [x]  Edit an existing event; verify it still targets a single calendar and does not duplicate.

## Calendar - Event Creation

- [x]  Open New Event dialog (FAB or toolbar); verify default date and time.
- [x]  Create event with title, time segment, and calendar; verify it appears.
- [x]  Add multiple time segments; verify each saves correctly.
- [x]  Add location via building + room; verify saved location.
- [x]  Use location search input and select suggestion; verify selection fills fields.
- [x]  Add description; verify saved and visible in details.
- [x]  Set request category; verify saved.
- [x]  Set participant count; verify saved.
- [x]  Set technician needed and equipment needed; verify saved.
- [x]  Set Zendesk ticket number; verify saved and searchable.
- [x]  Set informational event start/end and setup times; verify saved.
- [x]  Add hour log intervals; verify validation for invalid or incomplete rows.
- [x]  Assign assignee and add co-owners; verify saved and displayed in details.
- [x]  Add attendees; verify saved and displayed where applicable.
- [x]  added profiles are rebreed and input validated
- [x]  Save with invalid or missing required fields; verify error message.
- [x]  Open event details from calendar; verify details match saved data.
- [x]  Delete event from details; verify event removed.
- [x]  Edit event hour logs in details; verify save and total hours.

## Tickets

- [x]  Switch between Unassigned, Assigned, and All tickets views.
- [x]  Verify counts match ticket lists.
- [x]  Search tickets; verify list updates.
- [x]  Select a ticket row; verify preview panel updates.
- [x]  Verify status pill shows Open, Assigned, Closed correctly.
- [x]  Mobile: open a ticket from list; verify preview opens.
- [x]  Open Zendesk modal; verify it appears and closes.
- [x]  When double clicking the ticket it shoud open the full screen and stay on the ticket view

## Zendesk Hour Logging (Zendesk Queue)

- [ ]  Open Zendesk queue from Tickets; verify modal loads with Ready/Needs Logging tabs and counts.
- [ ]  Ready tab: ticket with hours logged shows Hours to copy, Zendesk ID, and Info entered button enabled.
- [ ]  Needs Logging tab: assigned ticket with no hours shows "No hours logged" status and Info entered disabled.
- [ ]  Needs Logging tab: logged hours but unconfirmed shows "Hours not confirmed" status.
- [ ]  After confirming a ticket, verify it disappears from both lists and counts update.
- [ ]  Add new hour logs to a previously confirmed ticket; verify it shows "New hours added" and returns to Needs Logging.
- [ ]  Confirm is blocked for tickets where the user is neither assignee nor logger; verify error handling.
- [ ]  Copy buttons: Zendesk ID disabled when missing; Hours disabled when total is 0; verify clipboard text format HH:MM:SS.
- [ ]  Queue list navigation: previous/next buttons disable at edges; "Ticket X of Y" updates correctly.
- [ ]  Empty states: Ready with no items shows "All caught up"; Needs Logging empty shows "No tickets needing attention."
- [ ]  Escape key closes the modal without mutating ticket state.

## Settings - Theme and Palettes

- [x]  Toggle Light, Dark, System mode; verify theme changes.
- [x]  Create new palette; verify it appears in list.
- [x]  Edit palette; verify changes persist.
- [x]  Delete palette; verify removal and fallback behavior.
- [x]  Assign palette to workspace; verify it becomes default.
- [x]  Apply preset palette; verify it appears and can be used.
- [x]  Apply a json pallate preset make sure it can be used

## Admin - Dashboard

- [x]  Load dashboard; verify summary cards and charts display.
- [x]  Verify active users list loads and last activity formats.
- [x]  Verify alerts list loads and severity styles.
- [x]  Verify upcoming events list loads and labels show.

## Admin - Company

- [ ]  Update business name/type; verify save and display.
- [ ]  Add building and rooms; verify in list.
- [ ]  Edit building name/acronym; verify save.
- [ ]  Edit room number; verify save.
- [ ]  Delete room; verify removed.
- [ ]  Delete building; verify removed with rooms.
- [ ]  Add department; verify in list and org chart.
- [ ]  Edit department name; verify save.
- [ ]  Change department parent; verify hierarchy updates.
- [ ]  Delete department; verify removal and warnings.
- [ ]  Drag department nodes; verify position persists.
- [ ]  Connect departments with drag handles; verify parent change and no cycles.

## Admin - Users

- [ ]  Search users by name/email/username; verify filtering.
- [ ]  Select user and update display name; verify save.
- [ ]  Update profile details and primary role; verify save.
- [ ]  Add new user with required fields; verify created and listed.
- [ ]  Deactivate user (not self); verify account marked inactive.
- [ ]  Verify role-based restrictions (manager vs admin) are enforced.
- [ ]  Add visibility grant; verify appears in list.
- [ ]  Remove visibility grant; verify removed.

## Admin - Reports

- [ ]  Load reports dashboard; verify summary cards display.
- [ ]  Verify building breakdowns, request mix, hours by department.
- [ ]  Verify Zendesk queue list displays and updates.
- [ ]  Change report type; verify preview table updates.
- [ ]  Adjust report parameters; verify preview updates.
- [ ]  Export CSV; verify file downloads and contents.
- [ ]  Export XLSX; verify file downloads and contents.
- [ ]  Use year window controls (multi-year report); verify range changes.

## Admin - Import/Export

- [ ]  Export snapshot; verify JSON downloads and message shows.
- [ ]  Refresh join table export; verify status updates.
- [ ]  Verify hour log export status and schedule info.
- [ ]  Import .ics file; verify preview list appears.
- [ ]  Filter .ics events by date; verify list updates.
- [ ]  Select subset of .ics events; import; verify events created.
- [ ]  Upload invalid snapshot file; verify error.
- [ ]  Upload valid snapshot; verify summary counts shown.
- [ ]  Restore snapshot only after confirm text and checkbox; verify completion.

## Admin - Database

- [ ]  View database summary counts and last refreshed time.
- [ ]  Run seed (workspace/events/full); verify success message and logs.
- [ ]  Run seed revert with confirmation; verify data removed.
- [ ]  Search events by title/code/Zendesk/id; verify list updates.
- [ ]  Delete a single event with confirmation; verify removed.
- [ ]  Bulk delete by date range; verify confirmation required.
- [ ]  Bulk delete all events; verify confirmation required and counts update.

## Responsiveness and Cross-Browser

- [ ]  Verify main flows on desktop and mobile breakpoints.
- [ ]  Verify calendar mobile toolbar and FAB behavior.
- [ ]  Verify tables and modals are usable on smaller screens.
- [ ]  Validate in Chrome, Edge, and Safari (or closest equivalents).

## Error and Edge Cases

- [ ]  Simulate API error on each major page; verify friendly error state.
- [ ]  Verify empty states (no events, no users, no reports, no palettes).
- [ ]  Verify loading states are visible for long operations.
- [ ]  Verify time inputs accept manual and dropdown values.
- [ ]  Verify date inputs handle invalid or empty values gracefully.
