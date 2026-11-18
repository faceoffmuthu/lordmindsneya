# Forgemind AI repository consolidation

## Decision

Treat the 46 repositories in the Forgemind-git organization as source material for one Lord Minds product, not as 46 runtime packages. The current project is already the assistant base (`openforge-ai`). The remaining repositories fall into three different groups: two larger business apps, workflow/agent examples, and course/resource material. Combining every folder into the running server would duplicate databases and authentication, add unrelated course files to production, and make deployment and upgrades harder.

The unified product boundary is one Lord Minds sign-in, one permission model, one web app, and one user-scoped data layer. The app now includes the assistant, Google/Drive, WhatsApp/Telegram, invite-managed accounts, a CRM pipeline and follow-up calendar, a per-user n8n workflow browser, keyword replies across messaging and social channels, consent-gated WhatsApp template broadcasts, and direct YouTube/Instagram/Facebook publishing. Course labs and the resources hub remain references instead of production runtime code.

## Repository inventory

GitHub listed 46 repositories in the Forgemind-git organization when this audit was made. “No detected license” means GitHub’s repository metadata did not identify a license; it is not permission to copy or redistribute the source.

| Repository | What it contributes | License signal | Consolidation treatment |
|---|---|---|---|
| [openforge-ai](https://github.com/Forgemind-git/openforge-ai) | Existing self-hosted assistant: tasks, calendar, mail, chats | MIT | Current Lord Minds base; do not duplicate |
| [ForgeGrowth-OSS](https://github.com/Forgemind-git/ForgeGrowth-OSS) | Instagram/WhatsApp automation, sales CRM, contacts, follow-ups; upstream HEAD checked 2026-11-11 (`ec03a0f`) | MIT | CRM pipeline board, stage counts, period totals, and monthly follow-up calendar are integrated on Lord Minds contacts and permissions. Existing Lord Minds flows cover keyword replies and uploads. Its separate backend and auth are not copied into the app. |
| [ForgeChat](https://github.com/Forgemind-git/ForgeChat) | WhatsApp CRM, contacts, templates, broadcasts, visual flows | Sustainable Use License | Feature reference only unless the product remains within the license’s internal/personal and distribution limits; preserve its notices if used |
| [n8n-mcp](https://github.com/Forgemind-git/n8n-mcp) | MCP server for creating and managing n8n workflows | MIT | Optional automation connector; run separately and integrate through a narrow API/MCP boundary |
| [N8N-OLLAMA_NGROK](https://github.com/Forgemind-git/N8N-OLLAMA_NGROK) | Local n8n/Ollama example | Apache-2.0 | Documentation/example material, not another app service |
| [N8N-tutorial](https://github.com/Forgemind-git/N8N-tutorial) | n8n tutorial | Apache-2.0 | Learning material |
| [Gmail-automation](https://github.com/Forgemind-git/Gmail-automation) | Gmail/n8n automation | Apache-2.0 | Workflow ideas; current project already has Gmail tools |
| [Gmail-AI-Agent](https://github.com/Forgemind-git/Gmail-AI-Agent) | Gmail agent examples | Apache-2.0 | Workflow ideas; current project already has Gmail search/read/draft support |
| [AI-agents-masterclass](https://github.com/Forgemind-git/AI-agents-masterclass) | Agent course example | No detected license | Keep as an upstream learning reference |
| [agentic-command-center](https://github.com/Forgemind-git/agentic-command-center) | Claude skill/command-center specification for connected business tools | No detected license | Use as a product reference; implement adapters within the Lord Minds tool and permission boundaries |
| [Apify-Scraper-Agent](https://github.com/Forgemind-git/Apify-Scraper-Agent) | Scraper agent example | No detected license | Reference only; implement a new connector if needed |
| [Gen-AI-types](https://github.com/Forgemind-git/Gen-AI-types) | Generative AI concepts/material | No detected license | Learning reference |
| [Google-business](https://github.com/Forgemind-git/Google-business) | Google Business example | No detected license | Reference only; not part of the current assistant’s core workflow |
| [Gmail-classifier](https://github.com/Forgemind-git/Gmail-classifier) | Gmail classification workflow | No detected license | Reference only; implement cleanly if requested |
| [IMAP-classifier](https://github.com/Forgemind-git/IMAP-classifier) | IMAP classification workflow | No detected license | Reference only |
| [Ultimate-classifier](https://github.com/Forgemind-git/Ultimate-classifier) | Email classification workflow | No detected license | Reference only |
| [e-commerce-order-placed](https://github.com/Forgemind-git/e-commerce-order-placed) | Order event workflow | No detected license | Reference only |
| [whatsapp-agent](https://github.com/Forgemind-git/whatsapp-agent) | WhatsApp agent workflow | No detected license | Reference only; current project already has WhatsApp chat tools |
| [Whatsapp-Sales-chatbot](https://github.com/Forgemind-git/Whatsapp-Sales-chatbot) | WhatsApp sales bot workflow | No detected license | Reference only |
| [whatsapp-appointment-booking](https://github.com/Forgemind-git/whatsapp-appointment-booking) | WhatsApp booking workflow | No detected license | Reference only |
| [whatsapp-expense-tracker](https://github.com/Forgemind-git/whatsapp-expense-tracker) | WhatsApp expense workflow | No detected license | Reference only |
| [whatsapp-task-manager](https://github.com/Forgemind-git/whatsapp-task-manager) | WhatsApp task workflow | No detected license | Reference only; Google Tasks already exists in the current app |
| [Whatsapp-Grocery-Agent](https://github.com/Forgemind-git/Whatsapp-Grocery-Agent) | Grocery assistant flow and n8n skills | No detected license | Reference only |
| [Whatsapp-bulk-message-agent](https://github.com/Forgemind-git/Whatsapp-bulk-message-agent) | Bulk messaging workflow | No detected license | Reference only; Lord Minds has a separate opt-in gated approved-template broadcast module |
| [task-agent](https://github.com/Forgemind-git/task-agent) | Task agent workflow | No detected license | Reference only; current app already has Google Tasks |
| [n8n-template-library](https://github.com/Forgemind-git/n8n-template-library) | Large catalog of n8n workflow JSON and text templates | No detected license | Do not vendor template contents; add user-supplied/imported templates through an n8n connector |
| [Forge-Resources-Hub](https://github.com/Forgemind-git/Forge-Resources-Hub) | Static resource/learning site with images and PDFs | No detected license | Keep as documentation/resource site, not production code |
| [course-materials](https://github.com/Forgemind-git/course-materials) | Course materials index | No detected license | Documentation reference |
| [.github](https://github.com/Forgemind-git/.github) | Organization profile content | No detected license | Organization metadata, not application code |
| [Office-setup](https://github.com/Forgemind-git/Office-setup) | Office/n8n setup guide and examples | No detected license | Documentation reference |
| [ho1-llm-eval](https://github.com/Forgemind-git/ho1-llm-eval) | Week 1 evaluation lab | No detected license | Course material; keep out of runtime |
| [ho2-askme-assistant](https://github.com/Forgemind-git/ho2-askme-assistant) | Week 2 assistant lab | No detected license | Course material; keep out of runtime |
| [ho3-prompt-library](https://github.com/Forgemind-git/ho3-prompt-library) | Week 2 prompt library lab | No detected license | Course material; keep out of runtime |
| [ho4-context-template](https://github.com/Forgemind-git/ho4-context-template) | Week 2 context template lab | No detected license | Course material; keep out of runtime |
| [ho5-research-assistant](https://github.com/Forgemind-git/ho5-research-assistant) | Week 3 research/RAG lab | No detected license | Course material; keep out of runtime |
| [ho6-skill-automation](https://github.com/Forgemind-git/ho6-skill-automation) | Week 3 skills/automation lab | No detected license | Course material; keep out of runtime |
| [ho7-capstone](https://github.com/Forgemind-git/ho7-capstone) | Week 3 capstone | No detected license | Course material; keep out of runtime |
| [ho8-mcp-server](https://github.com/Forgemind-git/ho8-mcp-server) | Week 4 MCP server lab | No detected license | Course material; keep out of runtime |
| [ho9-agent](https://github.com/Forgemind-git/ho9-agent) | Week 4 agent lab | No detected license | Course material; keep out of runtime |
| [ho10-agent-workflow](https://github.com/Forgemind-git/ho10-agent-workflow) | Week 4 agent/workflow lab | No detected license | Course material; keep out of runtime |
| [ho11-api-widget](https://github.com/Forgemind-git/ho11-api-widget) | Week 5 API widget lab | No detected license | Course material; keep out of runtime |
| [ho12-dashboard-ui](https://github.com/Forgemind-git/ho12-dashboard-ui) | Week 5 dashboard lab | No detected license | Course material; keep out of runtime |
| [ho13-cli-tool](https://github.com/Forgemind-git/ho13-cli-tool) | Week 5 CLI/data app lab | No detected license | Course material; keep out of runtime |
| [ho14-workflow-automation](https://github.com/Forgemind-git/ho14-workflow-automation) | Week 6 workflow lab | No detected license | Course material; keep out of runtime |
| [ho15-fullstack-app](https://github.com/Forgemind-git/ho15-fullstack-app) | Week 6 full-stack lab | No detected license | Course material; keep out of runtime |
| [ho16-final-capstone](https://github.com/Forgemind-git/ho16-final-capstone) | Week 6 final capstone | No detected license | Course material; keep out of runtime |

## Consolidation sequence

1. **Keep one product shell.** Continue using the existing Lord Minds app, user invitations, per-user integrations, and server-enforced permissions as the only sign-in and authorization system.
2. **Unify customer data.** Lord Minds now has scoped contacts, a draggable stage board, 7/30/90-day lead and win counts, tags, notes, WhatsApp opt-in state, and a monthly follow-up calendar, all on the existing per-user contact data.
3. **Unify automation.** Lord Minds now has per-user n8n workflow browsing plus deterministic keyword reply rules across WhatsApp, Telegram, Instagram, Facebook Messenger, and YouTube comments. Instagram comment flows can select a specific recent post, and YouTube comment flows can select a specific video (or scan the latest five). The Meta flow option applies one rule to WhatsApp, Instagram, and Messenger. YouTube video uploads can be published immediately or scheduled. Facebook Page post-comment automation is not implemented. n8n editing and execution remain inside the connected n8n instance.
4. **Add social channels as separate capabilities.** WhatsApp template broadcasts require explicit contact opt-in. Instagram private replies require a connected Meta app, valid account token, permissions, and webhook subscription; the app includes setup and user-scoped flow management.
5. **Keep learning assets out of production.** Course labs, PDFs, screenshots, and examples stay under documentation or a separate learning area; only material with a clear license should be copied into this repository.

The ForgeGrowth comparison was refreshed against upstream on 2026-11-11 (`ec03a0f`). This is a compatible consolidation, not a full feature-for-feature port. Custom pipeline configuration, deal values and payment/refund records, CSV/XLSX contact import, Instagram analytics/content library/DM and story automations, per-channel AI-agent builders, a branching WhatsApp canvas, and ForgeGrowth's Claude/MCP tool server are not implemented by this change. The Lord Minds flow editors remain keyword rules. Do not describe those upstream features as available in Lord Minds yet; each requires separate product and API work. Repo examples and course files without clear reuse rights remain upstream references.

## Source notes

- The ForgeGrowth repository describes itself as an MIT-licensed, single-tenant app with Instagram/WhatsApp automation and a sales CRM: <https://github.com/Forgemind-git/ForgeGrowth-OSS>.
- The latest source snapshot compared for this update is ForgeGrowth-OSS commit `ec03a0f`; its README documents additional CRM, Instagram, WhatsApp, and MCP capabilities beyond the features currently consolidated here.
- ForgeChat’s Sustainable Use License permits internal business or personal use, but limits distribution and requires preserving its notices: <https://github.com/Forgemind-git/ForgeChat/blob/main/LICENSE.md>.
- GitHub’s organization pages listed 46 repositories across page 1 and page 2: <https://github.com/orgs/Forgemind-git/repositories?type=all> and <https://github.com/orgs/Forgemind-git/repositories?type=all&page=2>.
