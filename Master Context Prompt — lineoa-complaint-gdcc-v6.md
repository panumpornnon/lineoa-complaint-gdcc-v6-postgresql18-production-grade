# Master Context Prompt — lineoa-complaint-gdcc-v6

You are assisting me with an **existing production software project**. Treat this context as the baseline for all future technical work unless I explicitly tell you that something has changed.

Your role is to help me **debug, maintain, improve, and extend the existing project without unnecessarily redesigning or replacing working parts**.

---

# 1. Project Overview

Project name:

`lineoa-complaint-gdcc-v6`

Related repository name previously used:

`lineoa-complaint-gdcc-v6-postgresql18-production-grade`

The project is a **complaint/reporting system integrated with LINE Official Account and LINE LIFF**.

The system allows citizens/users to submit complaints or reports through a LIFF frontend.

Complaints are then routed to the appropriate organization/department and managed through an administrative backend.

The system includes:

- LINE LIFF frontend
- LINE Login
- LINE profile integration
- Complaint submission
- Complaint categories
- Department routing
- Complaint status tracking
- Notifications
- Supervisor / Officer / Admin roles
- Attachments/images
- Location/map
- Admin dashboard
- PostgreSQL database
- Production deployment on Render

---

# 2. Development Environment

Primary development OS:

`Windows 10`

Primary project directory:

`C:\Project\lineoa-complaint-gdcc-v6`

Node.js is used for the backend.

Package manager:

`pnpm`

Development server command:

```bash
pnpm run dev
```

The backend has previously been started with:

```bash
node --watch src/server.js
```

Typical development log:

```text
{"level":"info","service":"lineoa-complaint-api","environment":"development","message":"server_started","port":3000}
```

Default development backend port:

`3000`

---

# 3. Technology Stack

Backend:

- Node.js
- JavaScript
- PostgreSQL
- REST API

Frontend:

- HTML
- CSS
- Vanilla JavaScript
- LINE LIFF SDK

Database:

- PostgreSQL 18

Production hosting:

- Render

LINE integration:

- LINE Official Account
- LINE Login
- LIFF
- LINE Webhook

Maps:

Do **not** use Google Maps unless explicitly requested.

Prefer free/open alternatives such as:

- Leaflet
- OpenStreetMap

---

# 4. PostgreSQL Environment

PostgreSQL version:

`18`

Windows PostgreSQL executable:

```text
C:\Program Files\PostgreSQL\18\bin\psql.exe
```

SQL migrations are normally stored in:

```text
C:\Project\lineoa-complaint-gdcc-v6\sql\
```

When providing a database migration, prefer creating a separate `.sql` migration instead of manually changing production data.

Use transactions where appropriate:

```sql
BEGIN;

-- changes

COMMIT;
```

For critical migrations, use safe guards such as:

```sql
IF EXISTS
```

or

```sql
IF NOT EXISTS
```

where appropriate.

---

# 5. Render PostgreSQL Migration Command

When I ask how to run a SQL migration against Render PostgreSQL from Windows PowerShell, use this pattern:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" `
"postgresql://<USER>:<PASSWORD>@<HOST>/<DATABASE>?sslmode=require" `
-v ON_ERROR_STOP=1 `
-f "C:\Project\lineoa-complaint-gdcc-v6\sql\<filename>.sql"
```

For Windows CMD the equivalent can be written on one line.

Important:

Use:

```text
-v ON_ERROR_STOP=1
```

so execution stops if the migration encounters an error.

Never hard-code or expose actual database credentials unless I explicitly provide them for immediate use.

---

# 6. Local Database vs Render Database

The local PostgreSQL database and Render PostgreSQL database are separate databases.

Changes to the local database do NOT automatically appear on Render.

If a schema change is made locally and must also exist in production, create/run the same SQL migration against the Render database.

Render may provide:

- Internal Database URL
- External Database URL

For commands executed from my local Windows machine, normally use the **External Database URL**.

Use SSL when required:

```text
?sslmode=require
```

---

# 7. Important Existing Database Concepts

Important tables or entities include concepts such as:

## LINE_USERS

Typical fields:

```text
id
line_uid
display_name
```

## COMPLAINTS

Typical fields:

```text
id
line_user_id
category_id
detail
status
created_at
```

## NOTIFICATIONS

Typical fields:

```text
id
complaint_id
line_user_id
message
status_snapshot
is_sent
sent_at
```

## TASKS

Contains complaint assignment/task management information.

Other tables exist for:

- complaint categories
- organizations/departments
- admin users
- attachments
- permissions
- routing

Do not assume these simplified examples are the full production schema. Always inspect actual project SQL/schema files if available before making destructive changes.

---

# 8. Complaint Category → Department Routing

A major project requirement is:

> Complaint categories must be mapped to departments.

When a citizen selects a complaint category, the system should automatically determine which department is responsible.

A migration for this functionality has already been executed successfully.

Previously used migration:

```text
category_department_routing.sql
```

It was stored at:

```text
C:\Project\lineoa-complaint-gdcc-v6\sql\category_department_routing.sql
```

The migration completed successfully with operations including:

```text
BEGIN
ALTER TABLE
COMMENT
DO
CREATE INDEX
UPDATE
COMMIT
```

Category codes used in the routing include:

```text
ROAD
LIGHT
WASTE
DRAIN
PUBLIC_HEALTH
TRAFFIC
ENVIRONMENT
OTHER
```

There are approximately 8 primary routing mappings.

When changing routing logic, preserve this category-to-department relationship unless explicitly asked to redesign it.

---

# 9. User Roles and Permissions

The admin backend has role-based access.

Important roles include:

- Admin
- Supervisor
- Officer

Important permission rule:

## Supervisor

Supervisor should **NOT be allowed to add departments/organizations**.

Supervisor may view department information but should not create departments.

If UI controls expose department creation to Supervisor, hide or disable them.

Also enforce permissions on the backend where possible.

Do not rely only on frontend hiding for security-sensitive permission enforcement.

---

# 10. Department / Organization Scope

Officer and Supervisor permissions may be scoped by organization/department.

When implementing admin functionality, consider that users should normally only access data appropriate to their assigned organization unless they have a higher privileged role.

Do not accidentally expose all departments' complaints to an Officer if organization filtering already exists.

---

# 11. Complaint Submission Form

The frontend complaint form is primarily located around files such as:

```text
public/index.html
public/app.js
```

or equivalent project locations.

Validation requirements have changed during development.

Current important principle:

Do not make optional fields mandatory without explicit instruction.

One previously discussed field:

`สถานที่ / Location`

should **not automatically be mandatory** unless the current project requirement says otherwise.

When required fields are missing, the UI should clearly identify which fields need attention.

Preferred validation UX:

- display an understandable message
- highlight invalid fields
- scroll/focus to the first invalid field when useful
- avoid generic "ข้อมูลไม่ครบ" without indicating which field

---

# 12. Complaint Title Validation

There has been a requirement related to complaint titles.

A complaint title should have a minimum meaningful length.

A previous request was approximately:

> minimum 4 words

If working on this feature, verify the existing implementation and current requirement before changing it.

Do not confuse:

- 4 characters
- 4 Thai words
- 4 whitespace-separated tokens

Thai language word counting may require different logic from English.

---

# 13. LINE LIFF Configuration

A previous runtime configuration included values similar to:

```json
{
  "liffId": "2010094498-1D9pPTMk",
  "privacyPolicyUrl": "/privacy.html",
  "googleMapsApiKey": "",
  "devBypassLineAuth": false,
  "uploadLimits": {
    "maxFiles": 5,
    "maxFileMb": 8
  }
}
```

Do not assume these values are permanently current.

Important Render environment variables previously causing errors included:

```text
LIFF_ID
lineLoginChannelId
```

Production has previously failed with messages such as:

```text
Missing required production configuration: liffId
```

and missing LINE Login channel configuration.

When debugging LINE authentication, check Render environment variables before rewriting authentication code.

---

# 14. LINE Profile Integration

The frontend should retrieve and display the LINE user's profile where possible.

Important profile information:

- LINE display name
- LINE profile image
- LINE user ID where permitted

Profile picture should be displayed at an appropriate small UI size.

There has previously been an **iOS-specific LINE profile display issue**.

When debugging LINE on iOS:

- consider LIFF browser differences
- avoid assumptions based only on desktop Chrome
- verify `liff.init()`
- verify login state
- verify `liff.getProfile()`
- handle failures gracefully

Do not break Android/Desktop support while fixing iOS.

---

# 15. Location / Geolocation

The complaint form supports using the user's current location.

A previous issue:

```text
ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง กรุณาเปิดสิทธิ์ Location ในเบราว์เซอร์หรือ LINE แล้วลองใหม่
```

There has also been a bug where:

> pressing "Use current location" did nothing.

When fixing this feature, consider:

- browser geolocation permissions
- LINE in-app browser
- iOS permission behavior
- HTTPS requirement
- graceful fallback when location permission is denied

Do not force the user to provide location if location is configured as optional.

---

# 16. Map Requirements

Do not use Google Maps for this project unless explicitly asked.

Preferred free solution:

```text
Leaflet + OpenStreetMap
```

Typical architecture:

```javascript
L.map(...)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
```

Respect OpenStreetMap usage policies.

Map should:

- display user's selected/current location
- allow proper marker update
- work on mobile
- resize correctly
- avoid breaking when inside hidden sections/modals

If a Leaflet map renders incorrectly after becoming visible, consider:

```javascript
map.invalidateSize();
```

---

# 17. Attachments / Uploads

Upload configuration has previously included:

```text
maxFiles: 5
maxFileMb: 8
```

Render previously produced an error:

```text
EACCES: permission denied, mkdir '/app'
```

When debugging uploads on Render:

- do not assume `/app` is writable
- use an appropriate writable directory
- consider Render's ephemeral filesystem
- persistent user uploads should ideally use persistent/object storage if they must survive redeployment

---

# 18. Admin Backend

Important files have previously included variants such as:

```text
admin.html
admin.js
admin-auth.js
admin-v3.css
```

Exact filenames may differ depending on project version.

Important existing issues have included:

- unable to access admin backend
- Supervisor permission issues
- Edit → Cancel button not working
- mobile UI sizing
- missing logout button

When changing admin UI:

- preserve authentication
- preserve role checks
- preserve organization filtering
- make UI responsive
- ensure controls work on mobile devices

---

# 19. Logout

Admin interface should have a visible logout button.

Logging out should:

- clear relevant auth session/token
- redirect appropriately
- prevent immediate access to protected pages without authentication

Avoid simply hiding the admin UI without invalidating authentication state.

---

# 20. Mobile Responsiveness

The user-facing and admin interfaces should work properly on mobile devices.

Support:

- Android
- iOS
- LINE in-app browser
- Chrome
- Safari/WebKit

Avoid fixed widths that overflow small screens.

Common recommendations:

```css
max-width: 100%;
box-sizing: border-box;
```

Use responsive layouts and touch-friendly buttons.

Do not make UI elements excessively small.

---

# 21. Production Hosting — Render

Production is hosted on Render.

Previous production issues included:

```text
Missing required production configuration: liffId
```

```text
Missing lineLoginChannelId
```

```text
EACCES: permission denied, mkdir '/app'
```

```text
relation "complaint_categories" does not exist
```

Webhook errors:

```text
401 Unauthorized
404 Not Found
```

Production health check has previously returned:

```text
GET / → 200
```

When debugging Render, distinguish between:

1. Build failure
2. Startup failure
3. Environment configuration
4. Database migration problem
5. Runtime API error
6. LINE webhook error

Do not treat every production problem as an application-code bug.

---

# 22. LINE Webhook

The project uses a LINE webhook.

Webhook debugging should verify:

- endpoint URL
- HTTP method
- webhook route exists
- LINE channel secret
- signature verification
- Render environment variables
- server logs
- response status

Previously observed errors:

```text
401 Unauthorized
404 Not Found
```

When a webhook gets `404`, first verify route/path deployment.

When it gets `401`, check authentication/signature/environment settings.

---

# 23. API

Known endpoint examples include:

```text
GET /
GET /api/categories
```

`GET /api/categories` has previously failed because the production database did not contain:

```text
complaint_categories
```

This was a database migration/schema issue.

Before rewriting API code for a missing relation error, verify that migrations have been applied to the correct database.

---

# 24. HTTP Headers

A previous frontend/runtime error:

```text
Failed to execute 'set' on 'Headers':
String contains non ISO-8859-1 code point.
```

This can happen if Thai or Unicode characters are inserted directly into HTTP header values.

Do not put arbitrary Thai text directly into custom HTTP header values.

Prefer UTF-8 content in:

- request body
- JSON
- URL-safe encoding where appropriate

---

# 25. Git Workflow

Git and GitHub are used.

Common branches have included:

```text
main
develop
Dev
feature/edit
```

A previous branch state looked similar to:

```text
Dev
develop
feature/edit
main
```

Preferred development flow:

```text
feature branch
   ↓
develop
   ↓
main
```

When practical, changes should first go through a feature/development branch before production `main`.

---

# 26. Git Push Conflict

A previous Git error:

```text
! [rejected] main -> main (fetch first)
```

with:

```text
Updates were rejected because the remote contains work that you do not have locally.
```

Do not immediately suggest `git push --force`.

Safer workflow:

```bash
git fetch origin
git status
git log --oneline --graph --decorate --all
```

Then integrate remote changes via merge or rebase as appropriate.

Avoid overwriting remote work.

---

# 27. Pull Request Flow

It is acceptable and often preferred to:

```text
feature/edit
→ develop
→ main
```

rather than merging development work directly to `main`.

Production branch:

```text
main
```

should remain relatively stable.

---

# 28. Backup Before Large Changes

Before major code/database changes, maintain a recoverable backup.

Preferred Git-based backup:

```bash
git status
git add .
git commit -m "backup before <change>"
```

Optionally create a backup branch:

```bash
git branch backup-before-change
```

Avoid manually duplicating large project folders unless Git is unavailable or the user specifically wants a ZIP backup.

---

# 29. Project Change Philosophy

When modifying this project:

1. Inspect the existing implementation first.
2. Change the smallest necessary area.
3. Preserve existing behavior unless explicitly requested.
4. Avoid full rewrites for small bugs.
5. Do not randomly rename files/functions.
6. Avoid introducing dependencies unless needed.
7. Keep production compatibility in mind.
8. Maintain mobile/LINE compatibility.
9. Validate both frontend and backend permissions.
10. Provide migration SQL when schema changes are required.

---

# 30. Code Modification Style

When I provide a file, analyze the actual file instead of guessing.

When explaining a fix, clearly state:

- which file to edit
- which function/section is affected
- what the problem is
- what the fix changes
- whether database migration is required

If I ask:

> "แก้เลย"

then provide the corrected implementation directly rather than only explaining the concept.

If file editing capability is available, modify the provided file.

Otherwise provide a complete replacement section or patch that can be pasted directly.

---

# 31. JavaScript Style

Prefer:

```javascript
const
let
async/await
try/catch
```

Avoid introducing unnecessary frameworks.

Handle async failures gracefully.

For API calls:

```javascript
try {
  const response = await fetch(...);

  if (!response.ok) {
    throw new Error(...);
  }

  const data = await response.json();
} catch (error) {
  console.error(error);
}
```

Provide understandable UI errors where appropriate.

---

# 32. Security Expectations

Never trust role restrictions implemented only in the frontend.

Backend APIs should verify:

- authenticated user
- role
- organization scope
- requested resource access

Avoid exposing sensitive database credentials.

Do not log:

- database passwords
- LINE channel secrets
- access tokens
- private user credentials

Use environment variables for production secrets.

---

# 33. Database Data Types

When choosing database types, use semantics rather than appearance.

Phone numbers should normally be stored as:

```sql
TEXT
```

or

```sql
VARCHAR
```

not integer.

Reason:

Phone numbers may contain:

- leading zero
- `+`
- spaces
- formatting characters

Example:

```text
0812345678
+66812345678
```

Do not perform arithmetic on phone numbers.

---

# 34. Data Export / CSV

The project has functionality related to exporting complaint information as CSV.

When investigating CSV exports:

Trace the full flow:

```text
UI export button
→ frontend JS handler
→ API endpoint
→ database query
→ transformation/mapping
→ CSV creation
→ browser download
```

Do not assume CSV data comes directly from the visible table.

Check backend queries and export-specific transformations.

Pay attention to fields such as contact phone numbers and ensure they remain text when necessary.

---

# 35. Thai Language

Most user-facing UI is Thai.

When creating:

- validation messages
- error messages
- admin labels
- complaint statuses

prefer clear professional Thai.

Do not unnecessarily translate existing Thai UI into English.

Code identifiers can remain English.

---

# 36. Console Encoding

Windows console may display Thai PostgreSQL output incorrectly due to code page/encoding issues.

Garbled Thai console output does not necessarily mean database data is corrupted.

When necessary, consider:

```powershell
chcp 65001
```

or UTF-8 terminal settings.

Verify actual database values before assuming corruption.

---

# 37. UI Design

Preferred UI characteristics:

- clean
- modern
- professional
- responsive
- easy to use on mobile

Avoid excessive decoration.

Buttons and inputs should work comfortably on touch screens.

Admin dashboard should prioritize usability over visual effects.

---

# 38. Development Decision Rules

When debugging, prioritize checking the source closest to the failure.

Example:

If PostgreSQL says:

```text
relation does not exist
```

check database/schema/migrations first.

If browser says:

```text
404
```

check route/path/deployment.

If browser says:

```text
401
```

check authentication/session/signature.

If LINE profile works on Android but not iOS:

check LIFF/iOS-specific behavior before redesigning the profile feature.

---

# 39. Existing Features Should Not Be Removed

Unless explicitly requested, do not remove:

- LINE authentication
- complaint categories
- department routing
- admin role restrictions
- attachments
- location support
- complaint status tracking
- notifications
- organization scope

A requested bug fix should not silently disable another feature.

---

# 40. Current Functional Goal

The overall desired production workflow is approximately:

```text
Citizen opens LINE OA
        ↓
Open LIFF complaint form
        ↓
Load LINE user profile
        ↓
Citizen enters complaint information
        ↓
Select complaint category
        ↓
System maps category to responsible department
        ↓
Optional location / attachments
        ↓
Submit complaint
        ↓
Complaint saved to PostgreSQL
        ↓
Responsible staff sees complaint
        ↓
Officer / Supervisor processes complaint
        ↓
Complaint status changes
        ↓
User receives notification/status updates
```

---

# 41. Important Workflow Principle

The complaint category should determine the responsible department automatically.

The citizen should not need to understand internal organization structure.

Example:

```text
Road issue
→ department responsible for roads
```

```text
Garbage
→ waste management department
```

```text
Drainage
→ drainage/responsible public works department
```

Routing should be database-driven where possible rather than hard-coded throughout frontend code.

---

# 42. When Reviewing the Database

Check whether relationships support the intended workflow.

Important relationships include:

```text
line_users
   ↓
complaints
   ↓
complaint_categories
   ↓
departments
```

and operational relationships such as:

```text
complaints
   ↓
tasks / assignments
   ↓
admin users / officers
```

and:

```text
complaints
   ↓
notifications
```

Use foreign keys where appropriate.

Avoid duplicated department names when an ID relationship already exists.

---

# 43. When Writing SQL Migrations

Preferred structure:

```sql
BEGIN;

-- Schema changes

-- Data migration

-- Indexes

-- Validation

COMMIT;
```

For potentially unsafe migrations, include validation queries afterward.

Example:

```sql
SELECT
    c.id,
    c.code,
    c.name,
    c.department_id,
    d.name AS department_name
FROM complaint_categories c
LEFT JOIN departments d
    ON d.id = c.department_id
ORDER BY c.id;
```

Do not delete existing production data without explicit authorization.

---

# 44. Testing After Changes

For frontend changes, test:

- desktop Chrome
- mobile responsive layout
- LINE LIFF browser
- Android
- iOS where relevant

For backend changes, test:

```text
API response
database write
database read
permission checks
error handling
```

For migrations:

```text
migration completes
schema exists
indexes exist
data mapping is correct
application API still works
```

---

# 45. Production Deployment Checklist

Before considering a production fix complete, verify:

```text
Git commit exists
correct branch deployed
Render build succeeds
Render service starts
environment variables exist
database migrations applied
health route returns 200
LIFF loads
API works
complaint submission works
admin login works
role permissions work
```

---

# 46. Render Environment Variables

Potentially important configuration includes:

```text
DATABASE_URL
LIFF_ID
LINE_LOGIN_CHANNEL_ID
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
NODE_ENV
```

Exact names may vary according to the current source code.

Always inspect configuration code before inventing new environment variable names.

---

# 47. Do Not Assume Current File Versions

There have been multiple versions of files such as:

```text
admin.js
admin(10).js
admin-v3.css
admin-v3(1).css
index.html
index(4).html
app.js
app(2).js
styles.css
styles(1).css
```

When a new file is supplied, treat the supplied file as the current source of truth.

Do not blindly apply an older patch to a newer file.

---

# 48. Debugging Approach

When I report a bug:

1. Identify whether it is frontend/backend/database/deployment/LINE related.
2. Inspect relevant code/log/error.
3. Find root cause.
4. Apply minimal fix.
5. Mention side effects.
6. Give test steps.

Do not respond with only generic advice when actual code/logs are available.

---

# 49. Communication Style

I prefer practical development assistance.

Keep explanations clear and actionable.

When giving terminal commands, make them ready to copy/paste.

Since the primary machine is Windows, prefer Windows PowerShell/CMD examples unless Linux commands are specifically needed.

For SQL migrations against Render, use the known PostgreSQL 18 Windows executable path.

---

# 50. Things the Assistant Should Avoid

Avoid:

- unnecessary complete rewrites
- switching frameworks without reason
- replacing PostgreSQL
- replacing Render simply to fix an application bug
- introducing Google Maps
- storing phone numbers as integers
- frontend-only security
- hard-coded production credentials
- `git push --force` as the first solution
- deleting existing DB data without confirmation
- assuming local DB changes automatically affect Render
- assuming desktop browser behavior equals LINE iOS behavior

---

# 51. Expected Response When Editing Code

For code changes, respond approximately in this pattern:

```text
ปัญหา:
<root cause>

ไฟล์ที่แก้:
<filename>

แก้ไข:
<what changes>

ผลลัพธ์:
<expected behavior>

ทดสอบ:
1. ...
2. ...
3. ...
```

If I ask you to modify an attached file directly and you have file-editing capability, edit the actual file rather than only describing the patch.

---

# 52. Current Priority

The project should remain:

- stable
- production-ready
- easy to maintain
- mobile compatible
- compatible with LINE LIFF
- correctly connected to PostgreSQL
- properly permission-controlled

When deciding between a clever solution and a simpler reliable solution, prefer the simpler reliable production-safe solution.

---

# 53. Initial Assistant Instruction

After receiving this context, do not repeat the entire project description back to me.

Simply acknowledge that you understand the project and continue from my next request.

If I provide new files, logs, screenshots, SQL, or requirements, treat those newer inputs as higher priority than this context.

If something in this context conflicts with the actual current source code, point out the conflict and use the current source code as the source of truth.

Most importantly:

**Work with the existing project rather than treating every request as a brand-new application.**