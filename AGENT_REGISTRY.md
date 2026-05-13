# Agent Registry

This registry catalogs development-time agents found under:

`C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents`

The agent files are not copied into this repository. They are not runtime dependencies, are not bundled with the app, and must not be referenced from production code.

Scanned source: 136 `.toml` agent files.

## Directly Relevant Agents

## nextjs-developer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\nextjs-developer.toml`
- Specialty: Next.js application structure, routing, server/client boundaries, and framework-specific implementation.
- When to use: Next.js app setup, route groups, app router pages, middleware, server actions, build issues, and deployment-oriented framework fixes.
- When not to use: Non-Next frontend work, database-only changes, or broad product decisions.
- Model preference: See source agent file.
- Related Kagu Saha modules: Project skeleton, auth routes, admin pages, personnel pages, API routes.

## typescript-pro
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\typescript-pro.toml`
- Specialty: TypeScript correctness, types, compiler configuration, and maintainable typed code.
- When to use: Shared types, Prisma-derived types, API contracts, strict compiler errors, and typed helper modules.
- When not to use: Visual-only UI polish or database operations with no TypeScript changes.
- Model preference: See source agent file.
- Related Kagu Saha modules: All TypeScript application code.

## react-specialist
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\react-specialist.toml`
- Specialty: React component architecture, client state, rendering behavior, and interactive UI.
- When to use: Admin drawers, calendar interactions, personnel task flow, form state, and responsive component behavior.
- When not to use: Pure backend, schema-only, or deployment-only changes.
- Model preference: See source agent file.
- Related Kagu Saha modules: Admin UI, personnel UI, shared components.

## frontend-developer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\frontend-developer.toml`
- Specialty: Scoped frontend implementation and UI bug fixes with production-level behavior.
- When to use: Page implementation, visual states, accessibility, empty/loading/error states, mobile usability.
- When not to use: Database schema design, authentication cryptography, or server deployment.
- Model preference: `gpt-5.4`, high reasoning in source file.
- Related Kagu Saha modules: Dashboard, projects, scheduling calendar, user management, personnel mobile screens.

## ui-designer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\ui-designer.toml`
- Specialty: Product UI layout, visual hierarchy, and screen-level design.
- When to use: Admin panel layout, personnel mobile-first screens, dashboard/table/drawer ergonomics.
- When not to use: Backend logic, database migrations, or unrelated visual redesigns outside MVP scope.
- Model preference: See source agent file.
- Related Kagu Saha modules: Admin layout, personnel task screens, responsive polish.

## ui-fixer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\ui-fixer.toml`
- Specialty: Targeted UI defects, responsive layout problems, overflow, spacing, and visual polish.
- When to use: Final responsive polish, browser QA findings, mobile overflow, drawer/table/calendar layout bugs.
- When not to use: New feature design or backend implementation.
- Model preference: See source agent file.
- Related Kagu Saha modules: Phase 15 responsive UI polish and QA fixes.

## accessibility-tester
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\accessibility-tester.toml`
- Specialty: Accessibility checks for keyboard behavior, focus, labels, contrast, and usable flows.
- When to use: Interactive admin controls, personnel one-button flow, forms, drawers, login, and mobile task cards.
- When not to use: Schema-only or infrastructure-only work.
- Model preference: See source agent file.
- Related Kagu Saha modules: Auth forms, admin forms, scheduling drawer, personnel task detail.

## backend-developer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\backend-developer.toml`
- Specialty: Scoped backend behavior, data integrity, auth checks, and failure-path handling.
- When to use: API routes, task event writes, timeline writes, file metadata writes, session logic, role enforcement.
- When not to use: Purely visual changes or broad architecture expansion.
- Model preference: `gpt-5.4`, high reasoning in source file.
- Related Kagu Saha modules: Auth, admin APIs, personnel task APIs, timeline/event writes.

## api-designer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\api-designer.toml`
- Specialty: API contracts, request/response shape, validation boundaries, and endpoint organization.
- When to use: Designing endpoints for users, projects, daily tasks, timeline, files, location, and offline sync.
- When not to use: Component layout or direct database administration.
- Model preference: See source agent file.
- Related Kagu Saha modules: `app/api`, personnel offline sync, admin CRUD endpoints.

## security-auditor
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\security-auditor.toml`
- Specialty: Application security review and risk identification.
- When to use: Auth/session review, password handling, file upload safety, route guards, role access boundaries.
- When not to use: Normal feature implementation before a security-sensitive path exists.
- Model preference: See source agent file.
- Related Kagu Saha modules: Auth, admin bootstrap, upload endpoints, route protection.

## penetration-tester
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\penetration-tester.toml`
- Specialty: Adversarial testing of exposed application behavior.
- When to use: Late-stage checks for login, authorization bypass, upload abuse, and API misuse.
- When not to use: Early product planning or routine CRUD implementation.
- Model preference: See source agent file.
- Related Kagu Saha modules: Auth, file upload, admin/personnel authorization.

## postgres-pro
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\postgres-pro.toml`
- Specialty: PostgreSQL schema, indexes, constraints, and query behavior.
- When to use: Prisma schema review, active assignment uniqueness strategy, timeline query performance, migration safety.
- When not to use: UI implementation or non-Postgres storage decisions.
- Model preference: See source agent file.
- Related Kagu Saha modules: Prisma schema, migrations, indexes, assignment constraints.

## database-optimizer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\database-optimizer.toml`
- Specialty: Query performance, indexing, and data access patterns.
- When to use: Dashboard task list, project search, timeline grouping, personnel daily task queries.
- When not to use: Initial simple schema before query patterns exist unless indexes are being chosen.
- Model preference: See source agent file.
- Related Kagu Saha modules: Dashboard, projects search, timeline, daily task listing.

## database-administrator
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\database-administrator.toml`
- Specialty: Operational database safety, backups, permissions, recovery, and runtime health.
- When to use: Test deploy preparation, production DB setup notes, backup/restore guidance.
- When not to use: Day-to-day Prisma model coding.
- Model preference: `gpt-5.4`, high reasoning in source file.
- Related Kagu Saha modules: Deployment preparation, PostgreSQL operations.

## test-automator
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\test-automator.toml`
- Specialty: Automated test design and implementation.
- When to use: Auth tests, API route tests, task flow tests, offline queue tests, regression coverage.
- When not to use: Manual acceptance testing or product decision writing.
- Model preference: See source agent file.
- Related Kagu Saha modules: Auth, APIs, daily task flow, offline queue.

## qa-expert
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\qa-expert.toml`
- Specialty: QA planning, acceptance scenarios, and risk-based verification.
- When to use: Phase completion checks, manual acceptance test preparation, smoke test lists.
- When not to use: Writing production feature code.
- Model preference: See source agent file.
- Related Kagu Saha modules: All phase gates and final acceptance testing.

## browser-debugger
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\browser-debugger.toml`
- Specialty: Browser-side debugging, runtime errors, console issues, network behavior, and UI verification.
- When to use: Local dev server QA, client-side exceptions, responsive verification, upload/location browser behavior.
- When not to use: Pure schema or server-only code review.
- Model preference: See source agent file.
- Related Kagu Saha modules: Browser QA for admin/personnel screens.

## debugger
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\debugger.toml`
- Specialty: General bug isolation and root-cause analysis.
- When to use: Failing build/test, broken task flow, unexpected persistence behavior, hard-to-localize defects.
- When not to use: Straightforward feature implementation.
- Model preference: See source agent file.
- Related Kagu Saha modules: Any failing phase.

## code-reviewer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\code-reviewer.toml`
- Specialty: Code review for bugs, regressions, missing tests, and maintainability risks.
- When to use: End of phase review, security-sensitive changes, migration review, PR review.
- When not to use: Initial implementation when no code exists yet.
- Model preference: See source agent file.
- Related Kagu Saha modules: All phase completion reviews.

## architect-reviewer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\architect-reviewer.toml`
- Specialty: Architecture review and boundary checks.
- When to use: Confirming the app remains simple, independent, and aligned with MVP decisions.
- When not to use: Small local bug fixes.
- Model preference: See source agent file.
- Related Kagu Saha modules: Phase boundaries, auth/data/layout architecture.

## deployment-engineer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\deployment-engineer.toml`
- Specialty: Deployment readiness, production build, environment variables, and release checks.
- When to use: Test deploy preparation, env documentation, build/start verification, migration deploy flow.
- When not to use: Early UI feature work.
- Model preference: See source agent file.
- Related Kagu Saha modules: Phase 16 test deploy preparation.

## devops-engineer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\devops-engineer.toml`
- Specialty: Operational pipeline and environment setup.
- When to use: Server setup notes, process management, environment consistency, deployment checks.
- When not to use: Product feature design.
- Model preference: See source agent file.
- Related Kagu Saha modules: Deployment and server operation notes.

## documentation-engineer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\documentation-engineer.toml`
- Specialty: Developer-facing documentation.
- When to use: README, setup docs, deploy docs, bootstrap docs, smoke-test documentation.
- When not to use: Runtime feature implementation.
- Model preference: See source agent file.
- Related Kagu Saha modules: README and deployment docs.

## technical-writer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\technical-writer.toml`
- Specialty: Clear technical writing for users and maintainers.
- When to use: User-facing setup notes, concise acceptance test instructions, operational handoff docs.
- When not to use: Source code changes.
- Model preference: See source agent file.
- Related Kagu Saha modules: README, manual acceptance test support.

## powershell-7-expert
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\powershell-7-expert.toml`
- Specialty: PowerShell scripting and Windows command workflows.
- When to use: Windows local setup scripts, safe bootstrap commands, local verification scripts.
- When not to use: Application runtime logic.
- Model preference: See source agent file.
- Related Kagu Saha modules: Local development scripts and Windows setup.

## build-engineer
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\build-engineer.toml`
- Specialty: Build systems, packaging, and build failures.
- When to use: `npm run build`, TypeScript build errors, Next build configuration, package scripts.
- When not to use: Feature design or business workflow decisions.
- Model preference: See source agent file.
- Related Kagu Saha modules: Project skeleton, CI/build readiness.

## dependency-manager
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\dependency-manager.toml`
- Specialty: Dependency selection, upgrades, and compatibility.
- When to use: Installing Next, Prisma, Tailwind, shadcn-related packages, and resolving dependency conflicts.
- When not to use: Product workflows with no dependency impact.
- Model preference: See source agent file.
- Related Kagu Saha modules: Phase 1 setup and dependency maintenance.

## product-manager
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\product-manager.toml`
- Specialty: Product scope, prioritization, and requirement clarity.
- When to use: Ambiguous MVP choices, phase ordering questions, acceptance criteria refinement.
- When not to use: Changing the binding product decisions without explicit user approval.
- Model preference: See source agent file.
- Related Kagu Saha modules: Scope guardrails and phase planning.

## project-manager
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\project-manager.toml`
- Specialty: Delivery sequencing and task tracking.
- When to use: Phase breakdown, release readiness, managing unfinished work.
- When not to use: Coding a specific feature.
- Model preference: See source agent file.
- Related Kagu Saha modules: Phase execution and status tracking.

## workflow-orchestrator
- Path: `C:\Users\ahmet\OneDrive\Belgeler\KAGUgit\AwesomeAgents\.codex\agents\workflow-orchestrator.toml`
- Specialty: Coordinating multi-step work.
- When to use: Larger phase transitions, complex debugging across frontend/backend/database.
- When not to use: Small single-file fixes.
- Model preference: See source agent file.
- Related Kagu Saha modules: Cross-cutting phase work.

## Indirect or Currently Out-of-Scope Agents

These agents were present in the scanned folder but are not expected to be used for the Kagu Saha MVP unless a specific future task directly calls for them:

`accessibility-tester`, `ad-security-reviewer`, `agent-installer`, `agent-organizer`, `ai-engineer`, `angular-architect`, `api-documenter`, `azure-infra-engineer`, `blockchain-developer`, `business-analyst`, `chaos-engineer`, `cli-developer`, `cloud-architect`, `code-mapper`, `competitive-analyst`, `compliance-auditor`, `content-marketer`, `context-manager`, `cpp-pro`, `csharp-developer`, `customer-success-manager`, `data-analyst`, `data-engineer`, `data-researcher`, `data-scientist`, `django-developer`, `docker-expert`, `docs-researcher`, `dotnet-core-expert`, `dotnet-framework-4.8-expert`, `dx-optimizer`, `electron-pro`, `elixir-expert`, `embedded-systems`, `erlang-expert`, `error-coordinator`, `error-detective`, `fintech-engineer`, `flutter-expert`, `fullstack-developer`, `game-developer`, `git-workflow-manager`, `golang-pro`, `graphql-architect`, `incident-responder`, `iot-engineer`, `it-ops-orchestrator`, `java-architect`, `javascript-pro`, `knowledge-synthesizer`, `kotlin-specialist`, `kubernetes-specialist`, `laravel-specialist`, `legacy-modernizer`, `legal-advisor`, `llm-architect`, `m365-admin`, `machine-learning-engineer`, `market-researcher`, `mcp-developer`, `microservices-architect`, `ml-engineer`, `mlops-engineer`, `mobile-app-developer`, `mobile-developer`, `multi-agent-coordinator`, `network-engineer`, `nextjs-developer`, `nlp-engineer`, `payment-integration`, `performance-engineer`, `performance-monitor`, `php-pro`, `platform-engineer`, `powershell-5.1-expert`, `powershell-module-architect`, `powershell-security-hardening`, `powershell-ui-architect`, `prompt-engineer`, `python-pro`, `quant-analyst`, `rails-expert`, `refactoring-specialist`, `research-analyst`, `reviewer`, `risk-manager`, `rust-engineer`, `sales-engineer`, `scrum-master`, `search-specialist`, `security-engineer`, `seo-specialist`, `slack-expert`, `spring-boot-engineer`, `sql-pro`, `sre-engineer`, `swift-expert`, `task-distributor`, `terraform-engineer`, `terragrunt-expert`, `tooling-engineer`, `trend-analyst`, `ux-researcher`, `vue-expert`, `websocket-engineer`, `windows-infra-admin`, `wordpress-master`.

