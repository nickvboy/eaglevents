---
Date Created: 2026-03-01T21:01:00
tags:
  - code
  - project
  - app
---
>[[Eaglevents_master]]

# Eaglevents Master QA Test Plan (Beta)

Use this checklist to validate end-to-end user flows before release. Each item is a test case.

### Notes

ODBE

- [ ] Ethe ODBE USERS you made
- [ ] In the odbe user should be able to press enter to accept a building number without it advancing to the next section
- [ ] Can not edit saved departments in the ODBE
- [ ] can not edit saved useres
- [ ] Theme Modal does not update its preview based on the preset
- [ ] When you change pages on the ODBE on the theme palette it will revert back to the base palette every time instead of saving your selection when navigating to each page.

## Authentication and Access

- [ ] The contact details sign in Page does not respect the palette.
- [ ] make the prodile icon Letter bigger also use the first and last initial

# Seed Workflows

## Authentication and Access

- [x] Sign up with valid username, email, password; verify success and auto-login attempt.
- [x] Sign up with existing email/username; verify error handling.
- [x] Sign in with username; verify redirect to callback URL or home.
- [x] Sign in with email; verify redirect to callback URL or home.
- [x] Sign in with invalid credentials; verify error message.
- [x] After signing in with a valid user, confirm the sidebar profile avatar shows the correct initial immediately on the first render (no blank/“U” state), and verify it remains correct after a full page reload and after signing out/in again.
- [x] Access protected page while signed out; verify redirect to login with callback URL.
- [x] Use Account menu to sign out; verify redirect to login.
- [x] Verify users without admin capability see “no access” in Admin panel.

## Profile Setup

- [x] After signup, complete profile creation and return to callback URL.
- [x] Verify profile form pre-fills email from session when available.
- [x] Validate phone formatting and error for < 10 digits.
- [x] Submit profile with missing required fields; verify validation message.
- [x] Submit profile with valid data; verify save and redirect.

## Navigation and Layout

- [x] Sidebar: navigate Home, Tickets, Calendar, Admin, Settings.
- [x] Verify Global Search appears only when signed in.
- [x] Verify layout hides sidebar on /login, /signup, /setup.

## Global Search

- [x] Search by event code; verify navigation to calendar with event focused.
- [ ] Search by Zendesk number; verify navigation to calendar with event focused.
- [ ] Verify that users can use arrow keys to move through global search results and press Enter to select or execute the highlighted result.
- [x] Search invalid identifier; verify “Ticket not found”.

## Calendar - Views and Navigation

- [ ] Switch between desktop and mobile views and verify the selected calendar timeframe stays consistent across both views rather than maintaining separate states.
- [ ] Verify that the selected calendar view (week, day, or work week) persists across the session and does not reset to the day view on reload or navigation.
- [x] Mini desktop calendar widget. Open month view and double click the year. Verify the year is editable or selectable.
- [x] Switch between day, 3-day, work week, week, and month views (desktop).
- [x] Navigate previous/next in each view; verify date changes correctly.
- [x] Use Today button; verify it returns to current date.
- [x] Change selected date via sidebar mini calendar (desktop).
- [x] On mobile, change view and date using mobile toolbar and date header.
- [x] on desktop change view switch to other pages and ensure that the calendar view stays constant
- [x] Month view: select a day; verify it switches to week view.

## Calendar - Calendar Management & Visibility

- [ ] Team calendars appear before personal calendars in the sidebar list.
- [ ] the calandar should load quickly
- [ ] Toggle a team calendar off; verify events disappear from the grid and agenda list.
- [ ] Toggle multiple calendars on/off; verify the visible set persists on refresh.
- [ ] Mini calendar list scrolls smoothly without showing a scrollbar; verify mouse wheel scrolls the list.
- [ ] When calandar changes colre it will chnage the event colors
- [ ] Personal calendar auto-names as "First L. Personal Calendar #N" and can be edited.
- [ ] Managers/admins can see personal calendars in scope; employees only see their own personal calendars.
- [ ] Administrators managers and Co admins should be able to remove calendars,

## Multi-Calendar Event Placement

- [ ] Create event with multiple calendars selected; verify duplicates appear on each selected calendar.
- [ ] Create event with no calendars selected; verify save is blocked with a clear error.
- [ ] Remove a selected calendar chip in the modal; verify it is removed from the target list.
- [ ] Edit an existing event; verify it still targets a single calendar and does not duplicate.

## Calendar - Event Creation

- [ ] Open New Event dialog (FAB or toolbar); verify default date and time.
- [ ] Create event with title, time segment, and calendar; verify it appears.
- [ ] Add multiple time segments; verify each saves correctly.
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
- [ ] added profiles are rebreed and input validated
- [ ] Save with invalid or missing required fields; verify error message.
- [ ] Open event details from calendar; verify details match saved data.
- [ ] Edit event hour logs in details; verify save and total hours.
- [ ] Delete event from details; verify event removed.
- [ ] Multi building and room support. Create an event with multiple rooms in the same building. Create an event with multiple buildings each with a single room. Verify all combinations save and display correctly.
- [ ] Building name with numbers. Create or select a building with a number in the name or acronym. Verify the room field does not append or inherit the building number.
- [ ] Building name update propagation. Rename a building. Open the New Event modal and verify the building dropdown reflects the updated name.
- [ ] Create a profile within the new event calandar modal. Select a profile from the dropdown and click Create Profile for “xxx”. Verify the profile is created successfully and the dropdown closes immediately after creation.
- [ ] Card preview dismissal. Open a card preview. Click anywhere outside the card and verify the preview dismisses. Click inside the card and verify the preview also dismisses. Verify dismissal is not limited to clicking the card itself.
- [ ] Manual time entry in new event modal. Open the New Event modal. Double click a time field and verify it becomes editable. Enter a time in HH:MM format such as 8:15 and select AM or PM from the dropdown. Verify input validation blocks invalid formats and saves valid input.
- [ ] Virtual location option behavior. In the event location section, select the Virtual Location checkbox. Verify the building selector becomes disabled and visually grayed out. Verify the event can be saved without a building selected only when Virtual Location is enabled.
- [ ] When adding a building number in the New Event modal, the building dropdown does not disappear when clicking off the field.
- [ ] Double click on any time field in the modal and it should allow users to edit time ensure the dropdown appears outside of the modal frame and side bar and it saves
- [ ] Verify that when a user creates an event, in the event modal the calendar chips automatically match the currently selected calendars and remain correctly reflected after the event modal is closed and reopened.
- [ ] Opening the New Event dialog pre-fills `Assign to` with the current user, and selecting additional users from that field adds them to `Co-owners` without replacing the primary assignee.
- [ ] In the event time fields, users can type a custom time, use `A` or `P` or full `AM/PM`, and confirm it with `Enter` or by tabbing out; the value formats correctly and becomes the selected dropdown option.
- [ ] Opening a profile quick-create form from attendee, co-owner, or assignee search closes the related search dropdown, and the `Assign to` section appears above `Co-owners`.
- [ ] In General building search, type a partial building or mixed query such as Ben, Hall, or Cohen ball, and verify the dropdown appears under the general field and returns matching results across all buildings by acronym, building name, or room name.
- [ ] In Specific building search, select a building like CC, type a partial room name such as ball or atri, and verify the dropdown appears under the room field and only shows rooms from that building such as COHEN BALLROOM or COHEN ATRIUM.
- [ ] Verify that the Assign To profile search correctly returns results for partial and full name inputs and prevents duplicate profile creation by prompting when an existing email or phone number is entered.
- [ ] Verify that the Equipment Needed section uses multi-select checkboxes instead of a text box, and that an Additional Information field only appears when Other is selected.
- [ ] Verify that the Event Type section appears after Equipment Needed, uses checkboxes, and allows the user to select from Recording, Stream, Panel, and Audio PA
- [ ] Verify that deleting an event triggers a confirmation dialog and only removes the event after the user explicitly confirms the action.
- [ ] Verify that entering an email with leading or trailing spaces is automatically trimmed and passes validation only if the remaining value is a valid email.
- [ ] Verify that users can navigate all form inputs and dropdown options in the events form using arrow keys and confirm selections using the Enter key.
- [ ] Verify that double clicking a profile chip within the Add Event dialog opens the profile edit interface and allows the user to update profile information successfully.
- [ ] When a user opens the create profile flow within the new event dialog, enters partial or complete information, and then clicks outside the modal or switches tabs, the create profile flow should remain open with all previously entered data and UI state preserved upon return, matching the persistence behavior of the main event modal.
- [ ] Verify that text content within the container wraps naturally instead of being truncated with ellipses. Confirm that long text remains fully visible across different screen sizes and container widths without overflow, clipping, or requiring user interaction such as hover or expansion.
- [ ] Verify that the create profile flow within the event dialog retains its open state and current progress when the user clicks outside the modal or switches tabs, consistent with the event modal’s behavior for preserving in progress input and UI context.

## Tickets

- [ ] Switch between Unassigned, Assigned, and All tickets views.
- [ ] Verify counts match ticket lists.
- [ ] Search tickets; verify list updates.
- [ ] Select a ticket row; verify preview panel updates.
- [ ] Verify status pill shows Open, Assigned, Closed correctly.
- [ ] Mobile: open a ticket from list; verify preview opens.
- [ ] Open Zendesk modal; verify it appears and closes.
- [ ] When double clicking the ticket it shoud open the full screen and stay on the ticket view

## Zendesk Hour Logging (Zendesk Queue)

- [ ] Open Zendesk queue from Tickets; verify modal loads with Ready/Needs Logging tabs and counts.
- [ ] Ready tab: ticket with hours logged shows Hours to copy, Zendesk ID, and Info entered button enabled.
- [ ] Needs Logging tab: assigned ticket with no hours shows "No hours logged" status and Info entered disabled.
- [ ] Needs Logging tab: logged hours but unconfirmed shows "Hours not confirmed" status.
- [ ] After confirming a ticket, verify it disappears from both lists and counts update.
- [ ] Add new hour logs to a previously confirmed ticket; verify it shows "New hours added" and returns to Needs Logging.
- [ ] Confirm is blocked for tickets where the user is neither assignee nor logger; verify error handling.
- [ ] Copy buttons: Zendesk ID disabled when missing; Hours disabled when total is 0; verify clipboard text format HH:MM:SS.
- [ ] queue list navigation: previous/next buttons disable at edges; "Ticket X of Y" updates correctly.
- [ ] Empty states: Ready with no items shows "All caught up"; Needs Logging empty shows "No tickets needing attention.”
- [ ] Escape key closes the modal without mutating ticket state.

## Settings - Theme and Palettes

- [ ] Toggle Light, Dark, System mode; verify theme changes.
- [ ] Create new palette; verify it appears in list.
- [ ] Edit palette; verify changes persist.
- [ ] Delete palette; verify removal and fallback behavior.
- [ ] Assign palette to workspace; verify it becomes default.
- [ ] Apply preset palette; verify it appears and can be used.
- [ ] Apply a json pallate preset make sure it can be used

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
- [ ] ensure there is error handeling when the user enters a duplicate room in the building
- [ ] Edit department name; verify save.
- [ ] Change department parent; verify hierarchy updates.
- [ ] Delete department; verify removal and warnings.
- [ ] Drag department nodes; verify position persists.
- [ ] Connect departments with drag handles; verify parent change and no cycles.
- [ ] Existing event building updates. Edit an existing event and update the building name and acronym. Save the event and verify the updated building name and acronym display correctly without requiring a building number change.
- [ ] Use the theme’s defined color component when assigning a calendar color in the color picker, instead of the browser’s default color value. Verify that the selected calendar color matches the app theme consistently after selection and save.

## Admin - Users

- [ ] Search users by name/email/username; verify filtering.
- [ ] Add new user with required fields; verify created and listed.
- [ ] Deactivate user (not self); verify account marked inactive.
- [ ] Verify role-based restrictions (manager vs admin) are enforced.
- [ ] Add visibility grant; verify appears in list.
- [ ] Remove visibility grant; verify removed.
- [ ] Verify that admins can search for and select an existing profile during the user creation flow. 

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
- [ ] Verify that an admin can select specific events by checkbox from the Import / Export tab, export them to CSV, modify or add rows, and reimport the file so existing events are updated by event ID and new rows are created successfully.
- [ ] Verify that all CSV import rows go through the same required field checks, formatting validation, and business rules as the standard single event creation and edit flow, and that invalid rows are rejected or flagged consistently

## Admin - Database

- [ ] View database summary counts and last refreshed time.
- [ ] Search events by title/code/Zendesk/id; verify list updates.
- [ ] Delete a single event with confirmation; verify removed.
- [ ] Bulk delete by date range; verify confirmation required.
- [ ] Bulk delete all events; verify confirmation required and counts update.

## Error and Edge Cases

- [ ] Simulate API error on each major page; verify friendly error state.
- [ ] Verify empty states (no events, no users, no reports, no palettes).
- [ ] Verify loading states are visible for long operations.
- [ ] Verify time inputs accept manual and dropdown values.
- [ ] Verify date inputs handle invalid or empty values gracefully.