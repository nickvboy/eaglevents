# Eaglevents Master QA Test Plan (Beta)

Use this checklist to validate end-to-end user flows before release. Each item is a test case.

## Preflight and Test Data
- [ ] Confirm environment, base URL, and build version used for this test run.
- [ ] Create or confirm accounts for each role: admin, co-admin, manager, employee.
- [ ] Ensure at least 1 business, 2 buildings, 4 rooms, 2 departments, 1 division exist.
- [ ] Ensure at least 2 calendars exist (one primary), and at least 5 events exist.
- [ ] Ensure at least 3 tickets exist: 1 unassigned, 1 assigned, 1 closed (past end time).
- [ ] Confirm Zendesk ticket numbers exist on at least 2 events for search and reporting.

## Authentication and Access
- [ ] Sign up with valid username, email, password; verify success and auto-login attempt.
- [ ] Sign up with existing email/username; verify error handling.
- [ ] Sign in with username; verify redirect to callback URL or home.
- [ ] Sign in with email; verify redirect to callback URL or home.
- [ ] Sign in with invalid credentials; verify error message.
- [ ] Access protected page while signed out; verify redirect to login with callback URL.
- [ ] Use Account menu to sign out; verify redirect to login.
- [ ] Verify users without admin capability see "no access" in Admin panel.

## Profile Setup
- [ ] After signup, complete profile creation and return to callback URL.
- [ ] Verify profile form pre-fills email from session when available.
- [ ] Validate phone formatting and error for < 10 digits.
- [ ] Submit profile with missing required fields; verify validation message.
- [ ] Submit profile with valid data; verify save and redirect.
- [ ] Revisit profile creation when profile exists; verify form pre-populated.

## Setup Wizard (Onboarding)
- [ ] Open /setup when setup is required; verify step gating and progress list.
- [ ] Business step: save business name/type; verify success and lock state.
- [ ] Buildings step: add building and rooms; verify save and list display.
- [ ] Buildings step: attempt save with missing building/rooms; verify error.
- [ ] Departments step: add department and optional divisions; verify save and list display.
- [ ] Departments step: attempt save with invalid name; verify error.
- [ ] Users step: create user with role assignments; verify success and list update.
- [ ] Users step: create default accounts; verify credentials list appears.
- [ ] Users step: clear all accounts; verify warning and data cleared.
- [ ] Users step: remember credentials for post-setup login; verify used on completion.
- [ ] Theme step: select base palette; verify preview updates.
- [ ] Theme step: create new theme; verify it appears and is selected.
- [ ] Theme step: apply preset; verify applied and saved.
- [ ] Completion step: verify readiness list and missing admins warning.
- [ ] Complete setup; verify redirect to home and setup no longer required.

## Navigation and Layout
- [ ] Sidebar: navigate Home, Tickets, Calendar, Admin, Settings.
- [ ] Verify Global Search appears only when signed in.
- [ ] Verify layout hides sidebar on /login, /signup, /setup.

## Database Seeding Flow
- [ ] Open Admin > Database; verify seed panel loads with mode options (Full, Workspace, Events, Revert).
- [ ] Full mode: run with default count (~420); verify success, logs, and historical events spanning 7 years.
- [ ] Full mode: verify events include Zendesk tickets, hour logs, attendees, and varied properties.
- [ ] Workspace mode: run seed; verify business, buildings, departments, users created; no events.
- [ ] Workspace mode: run again; verify idempotent (logs show "already exists" messages).
- [ ] Events mode: set count = 0; verify no events created.
- [ ] Events mode: set count = 15; verify 15 events in next 90 days with existing users.
- [ ] Events mode: verify error if workspace not initialized.
- [ ] Department targets: add specific department/division counts; verify events created for those scopes.
- [ ] Faker seed: set seed value; run twice; verify deterministic data (identical results).
- [ ] Revert mode: enter confirmation; verify all workspace data removed and setup reset.
- [ ] Revert mode: run on clean database; verify "already clean" message.
- [ ] Verify event count validation (0-10000) and Faker seed validation (numeric).
- [ ] Verify seeded events use real buildings/rooms and have realistic times and properties.
- [ ] Verify seed logs display during operation and show detailed progress.

## Global Search
- [ ] Search by event ID; verify navigation to calendar with event focused.
- [ ] Search by event code; verify navigation to calendar with event focused.
- [ ] Search by Zendesk number; verify navigation to calendar with event focused.
- [ ] Search invalid identifier; verify "Ticket not found".
- [ ] Submit empty search; verify "Enter a ticket identifier".
- [ ] Simulate API error; verify "Search failed".

## Calendar - Views and Navigation
- [ ] Switch between day, 3-day, work week, week, and month views (desktop).
- [ ] Navigate previous/next in each view; verify date changes correctly.
- [ ] Use Today button; verify it returns to current date.
- [ ] Toggle visible calendars; verify events filter accordingly.
- [ ] Change selected date via sidebar mini calendar (desktop).
- [ ] On mobile, change view and date using mobile toolbar and date header.
- [ ] Open mobile month picker; select a date; verify view updates.
- [ ] Month view: select a day; verify it switches to week view.
- [ ] Verify events render with correct time labels and all-day labels.

## Calendar - Event Creation
- [ ] Open New Event dialog (FAB or toolbar); verify default date and time.
- [ ] Create event with title, time segment, and calendar; verify it appears.
- [ ] Add multiple time segments; verify each saves correctly.
- [ ] Toggle All day; verify time fields adjust as expected.
- [ ] Toggle In-person and Recurring; verify flags persist after save.
- [ ] Add location via building + room; verify saved location.
- [ ] Use location search input and select suggestion; verify selection fills fields.
- [ ] Add description; verify saved and visible in details.
- [ ] Set request category; verify saved.
- [ ] Set participant count; verify saved.
- [ ] Set technician needed and equipment needed; verify saved.
- [ ] Set Zendesk ticket number; verify saved and searchable.
- [ ] Set informational event start/end and setup times; verify saved.
- [ ] Add hour log intervals; verify validation for invalid or incomplete rows.
- [ ] Assign assignee and add co-owners; verify saved and displayed in details.
- [ ] Add attendees; verify saved and displayed where applicable.
- [ ] Save with invalid or missing required fields; verify error message.

## Calendar - Event Editing and Deletion
- [ ] Open event details from calendar; verify details match saved data.
- [ ] Click Edit from details; verify dialog opens with existing values.
- [ ] Update event fields; verify changes persist.
- [ ] Delete event from details; verify event removed.
- [ ] Edit event hour logs in details; verify save and total hours.

## Tickets
- [ ] Switch between Unassigned, Assigned, and All tickets views.
- [ ] Verify counts match ticket lists.
- [ ] Search tickets; verify list updates.
- [ ] Select a ticket row; verify preview panel updates.
- [ ] Verify status pill shows Open, Assigned, Closed correctly.
- [ ] Mobile: open a ticket from list; verify preview opens.
- [ ] Open Zendesk modal; verify it appears and closes.

## Settings - Theme and Palettes
- [ ] Toggle Light, Dark, System mode; verify theme changes.
- [ ] Create new palette; verify it appears in list.
- [ ] Edit palette; verify changes persist.
- [ ] Delete palette; verify removal and fallback behavior.
- [ ] Assign palette to workspace; verify it becomes default.
- [ ] Assign palette to a department; verify assignment persists.
- [ ] Apply preset palette; verify it appears and can be used.

## Admin - Dashboard
- [ ] Load dashboard; verify summary cards and charts display.
- [ ] Verify active users list loads and last activity formats.
- [ ] Verify alerts list loads and severity styles.
- [ ] Verify upcoming events list loads and labels show.

## Admin - Company
- [ ] Update business name/type; verify save and display.
- [ ] Add building and rooms; verify in list.
- [ ] Edit building name/acronym; verify save.
- [ ] Edit room number; verify save.
- [ ] Delete room; verify removed.
- [ ] Delete building; verify removed with rooms.
- [ ] Add department; verify in list and org chart.
- [ ] Edit department name; verify save.
- [ ] Change department parent; verify hierarchy updates.
- [ ] Delete department; verify removal and warnings.
- [ ] Drag department nodes; verify position persists.
- [ ] Connect departments with drag handles; verify parent change and no cycles.

## Admin - Users
- [ ] Search users by name/email/username; verify filtering.
- [ ] Select user and update display name; verify save.
- [ ] Update profile details and primary role; verify save.
- [ ] Add new user with required fields; verify created and listed.
- [ ] Deactivate user (not self); verify account marked inactive.
- [ ] Verify role-based restrictions (manager vs admin) are enforced.
- [ ] Add visibility grant; verify appears in list.
- [ ] Remove visibility grant; verify removed.

## Admin - Reports
- [ ] Load reports dashboard; verify summary cards display.
- [ ] Verify building breakdowns, request mix, hours by department.
- [ ] Verify Zendesk queue list displays and updates.
- [ ] Change report type; verify preview table updates.
- [ ] Adjust report parameters; verify preview updates.
- [ ] Export CSV; verify file downloads and contents.
- [ ] Export XLSX; verify file downloads and contents.
- [ ] Use year window controls (multi-year report); verify range changes.

## Admin - Import/Export
- [ ] Export snapshot; verify JSON downloads and message shows.
- [ ] Refresh join table export; verify status updates.
- [ ] Verify hour log export status and schedule info.
- [ ] Import .ics file; verify preview list appears.
- [ ] Filter .ics events by date; verify list updates.
- [ ] Select subset of .ics events; import; verify events created.
- [ ] Upload invalid snapshot file; verify error.
- [ ] Upload valid snapshot; verify summary counts shown.
- [ ] Restore snapshot only after confirm text and checkbox; verify completion.

## Admin - Database
- [ ] View database summary counts and last refreshed time.
- [ ] Run seed (workspace/events/full); verify success message and logs.
- [ ] Run seed revert with confirmation; verify data removed.
- [ ] Search events by title/code/Zendesk/id; verify list updates.
- [ ] Delete a single event with confirmation; verify removed.
- [ ] Bulk delete by date range; verify confirmation required.
- [ ] Bulk delete all events; verify confirmation required and counts update.

## Responsiveness and Cross-Browser
- [ ] Verify main flows on desktop and mobile breakpoints.
- [ ] Verify calendar mobile toolbar and FAB behavior.
- [ ] Verify tables and modals are usable on smaller screens.
- [ ] Validate in Chrome, Edge, and Safari (or closest equivalents).

## Error and Edge Cases
- [ ] Simulate API error on each major page; verify friendly error state.
- [ ] Verify empty states (no events, no users, no reports, no palettes).
- [ ] Verify loading states are visible for long operations.
- [ ] Verify time inputs accept manual and dropdown values.
- [ ] Verify date inputs handle invalid or empty values gracefully.
