# QA_MASTER_TEST_PLAN

# Eaglevents Master QA Test Plan (Beta)

Use this checklist to validate end-to-end user flows before release. Each item is a test case.

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

- [ ]  Team calendars appear before personal calendars in the sidebar list.
- [ ]  Toggle a team calendar off; verify events disappear from the grid and agenda list.
- [ ]  Toggle multiple calendars on/off; verify the visible set persists on refresh.
- [ ]  Mini calendar list scrolls smoothly without showing a scrollbar; verify mouse wheel scrolls the list.
- [ ]  Personal calendar auto-names as "First L. Personal Calendar #N" and can be edited.
- [ ]  Managers/admins can see personal calendars in scope; employees only see their own personal calendars.

## Calendar - Multi-Calendar Event Placement

- [ ]  Create event with multiple calendars selected; verify duplicates appear on each selected calendar.
- [ ]  Create event with no calendars selected; verify save is blocked with a clear error.
- [ ]  Create event while specific calendars are toggled on in sidebar; verify modal preselects those calendars.
- [ ]  Remove a selected calendar chip in the modal; verify it is removed from the target list.
- [ ]  Edit an existing event; verify it still targets a single calendar and does not duplicate.

## Calendar - Event Creation

- [x]  Open New Event dialog (FAB or toolbar); verify default date and time.
- [ ]  Create event with title, time segment, and calendar; verify it appears.
- [ ]  Add multiple time segments; verify each saves correctly.
- [ ]  Toggle All day; verify time fields adjust as expected.
- [ ]  Toggle In-person and Recurring; verify flags persist after save.
- [ ]  Add location via building + room; verify saved location.
- [ ]  Use location search input and select suggestion; verify selection fills fields.
- [ ]  Add description; verify saved and visible in details.
- [ ]  Set request category; verify saved.
- [ ]  Set participant count; verify saved.
- [ ]  Set technician needed and equipment needed; verify saved.
- [ ]  Set Zendesk ticket number; verify saved and searchable.
- [ ]  Set informational event start/end and setup times; verify saved.
- [ ]  Add hour log intervals; verify validation for invalid or incomplete rows.
- [ ]  Assign assignee and add co-owners; verify saved and displayed in details.
- [ ]  Add attendees; verify saved and displayed where applicable.
- [ ]  Save with invalid or missing required fields; verify error message.

## Calendar - Event Editing and Deletion

- [ ]  Open event details from calendar; verify details match saved data.
- [ ]  Click Edit from details; verify dialog opens with existing values.
- [ ]  Update event fields; verify changes persist.
- [ ]  Delete event from details; verify event removed.
- [ ]  Edit event hour logs in details; verify save and total hours.

## Tickets

- [ ]  Switch between Unassigned, Assigned, and All tickets views.
- [ ]  Verify counts match ticket lists.
- [ ]  Search tickets; verify list updates.
- [ ]  Select a ticket row; verify preview panel updates.
- [ ]  Verify status pill shows Open, Assigned, Closed correctly.
- [ ]  Mobile: open a ticket from list; verify preview opens.
- [ ]  Open Zendesk modal; verify it appears and closes.

## Settings - Theme and Palettes

- [ ]  Toggle Light, Dark, System mode; verify theme changes.
- [ ]  Create new palette; verify it appears in list.
- [ ]  Edit palette; verify changes persist.
- [ ]  Delete palette; verify removal and fallback behavior.
- [ ]  Assign palette to workspace; verify it becomes default.
- [ ]  Assign palette to a department; verify assignment persists.
- [ ]  Apply preset palette; verify it appears and can be used.

## Admin - Dashboard

- [ ]  Load dashboard; verify summary cards and charts display.
- [ ]  Verify active users list loads and last activity formats.
- [ ]  Verify alerts list loads and severity styles.
- [ ]  Verify upcoming events list loads and labels show.

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
