# Flexible Grounded Material Assistant — Epic Design

## Goal

Help customers find the right material and help staff answer product questions quickly. The assistant should understand natural Vietnamese phrasing, provide a response shaped for the question, and ground every product, price, and recommendation in data the caller is allowed to see.

The experience should feel flexible rather than scripted. The system standardizes how it finds, checks, and presents evidence; it does not prescribe one fixed sentence for each question.

## Users and priorities

- **P0:** customers and staff can ask about prices, product lists, product facts, and advice; the assistant handles ambiguity and multi-part questions safely.
- **P1:** the assistant can offer evidence-based recommendations, compare explicitly named or confirmed products, and understand follow-up questions.
- **P2:** users can give useful feedback and the project can measure retrieval, answer, citation, price, and abstention quality on a maintained evaluation set.

## Current repository context

The repository already contains hybrid lexical/vector retrieval, query understanding and hard filters, current SQL price lookup, citations, follow-up resolution, user-scoped conversation APIs, feedback routes, public and authenticated catalog paths, and variant-group listing. The existing query service still combines routing, retrieval, filtering, answer selection, and response construction in one flow. List intent is partly explicit-rule based, and the current group expansion starts from retrieved seed variants; it cannot by itself prove that a broad catalog request is complete. Conversation persistence is user-scoped, so anonymous customer continuity needs a deliberate session boundary.

The epic should extend these boundaries rather than replace the price source, bypass RLS, or rebuild existing catalog, order, and conversation features.

## Core design

Use a three-stage answer pipeline: **understand the request, assemble authorized evidence, then compose and validate a response**.

### 1. Understand the request flexibly

Create a query plan from natural language rather than growing a list of phrase-specific answer branches. The plan may contain one or more intents and normalized entities, including product names/aliases/SKUs, dimensions or other stated specifications, price tier, information requested, comparison targets, advice constraints, references to earlier turns, and unresolved fields.

Use the configured language model to interpret varied wording and multi-part questions into a validated structured plan. Deterministic parsing and catalog matches remain useful as evidence and confidence signals. Do not let an unvalidated model plan invoke arbitrary tools or widen a caller's access. If intent, product, or required attribute confidence is insufficient, ask one focused clarification question and retain the confirmed context.

### 2. Assemble evidence from the right source

The orchestrator routes each part of the plan to a typed retrieval path:

- **Product identity and specifications:** structured catalog search across product names, aliases, SKUs, and indexed specification fields; normalize Vietnamese accents while preserving meaningful numbers, codes, and units.
- **Complete listings:** a catalog query, not vector top-k, defines membership, total count, and pagination. A response must distinguish the current page from the complete result set. The existing seed-to-sibling variant RPC remains useful for a known product group, but is not the completeness mechanism for broad category or all-product requests.
- **Current price:** read the eligible active price row from SQL after resolving the exact variant and package. Include price tier, unchanged amount, unit/package, validity, and source identity. Never read a price from an embedding, old answer, or generated text.
- **Product/document facts:** hybrid retrieval over verified current catalog facts and approved source pages/chunks. Include page, source revision, and available span/citation metadata.
- **Advice and comparisons:** retrieve facts for only the products and constraints in the plan. Missing attributes remain missing; similarity alone is not proof of suitability.

Each retrieval result becomes a typed evidence packet containing allowed product IDs, variant and package IDs, current price IDs/versions, factual fields, citations, source freshness, and explicit missing fields. Apply customer-public or staff-authorized boundaries before evidence reaches the model.

### 3. Compose a response that fits the question

The model generates concise, natural Vietnamese in a validated response structure, not from fixed response strings. The structure identifies the response kind (direct answer, list, clarification, comparison, recommendation, unsupported/out-of-scope), a flexible text response, evidence-backed claims, citations, relevant product cards, and available next actions. Blocks are optional and can vary with the question; the schema provides consistent behavior without forcing identical wording.

The model may explain and organize evidence, but the application owns authoritative values and actions:

- Render prices, quantities, package units, and price versions from SQL-backed fields, not model-generated numbers.
- Every factual claim must refer to evidence IDs supplied for this answer. Reject unknown IDs, citations, variants, or price IDs; omit or regenerate invalid generated claims.
- Render source links from validated source metadata. Never invent page numbers or URLs.
- Keep list completeness and pagination metadata separate from generated prose; do not let the model claim “all” unless the catalog query says the result set is complete.
- Return clarification or insufficient evidence when a key field has no support; do not substitute a near match.

This creates a consistent contract and validation system while allowing wording, ordering, and explanation depth to respond to the user's actual question.

## Conversation context

Use prior turns to resolve references such as “còn loại lớn hơn?” and to preserve confirmed constraints. Context is a hint for query interpretation, never evidence or authorization. Re-run catalog and price retrieval for each new turn so a changed price is reflected immediately.

Authenticated conversations continue to use existing user ownership and RLS. Anonymous customers may receive short-lived session context without account creation; its state must be bounded, non-authoritative, and free of unnecessary personal data. A client-provided context cannot select private data or establish a trusted role.

## Access and safety boundaries

- Customers use only public RPCs and public product, price, and source fields.
- Staff use the existing authenticated client and RLS for any staff-only facts.
- Do not introduce service-role access, impersonated identities, broad `SECURITY DEFINER` reads, or direct anonymous table access.
- Validate every action, selection, and price version server-side; assistant output alone never mutates prices or creates an order.
- Out-of-scope questions receive a clear boundary response rather than a semantically nearby product.
- Do not put secrets, tokens, full private prompts, or unnecessary personal data in logs or feedback records.

## User story coverage

### P0

- **US-01 Intent:** recognize price, list, product information, advice, comparison, follow-up, multi-part, and out-of-scope intent; clarify uncertain parts.
- **US-02 Complete listing:** search the structured catalog, report total and current page, and provide a continuation action without overstating completeness.
- **US-03 Identity:** match accentless names, aliases, SKU, and explicit specifications; distinguish similar products and request confirmation when ambiguous.
- **US-04 Grounded facts:** answer product and document questions only from verified evidence with usable source citations.
- **US-05 Current prices:** show the current SQL price, tier, unit/package, and source; never estimate missing prices.
- **US-06 Advice clarification:** ask for missing use, dimension, or environment constraints; do not make a strong recommendation without relevant evidence.

### P1

- **US-07 Recommendations:** explain each candidate using retrieved attributes or documents, show limitations, and allow users to open the exact product/variant and price.
- **US-08 Comparisons:** compare only explicitly named or user-confirmed candidates; show known fields and prices with citations and mark absent facts.
- **US-09 Follow-ups:** preserve confirmed product/constraint context, ask when a reference has multiple plausible meanings, and refresh mutable facts such as price.
- **US-10 Roles:** maintain separate public and staff evidence paths with the existing RLS and narrow RPC rules.

### P2

- **US-11 Feedback:** connect a feedback event to its user question, response, retrieval trace, and a controlled reason such as wrong product, missing source, missing specification, or failed answer.
- **US-12 Evaluation:** maintain expected product/variant/price/source outcomes and measure each quality dimension independently.

## Evaluation and acceptance

Build a versioned evaluation set covering direct and accentless lookup, alias/SKU, near specifications, full lists and pagination, no-price and historical-price questions, product/document facts, ambiguity, advice with missing attributes, comparison, multi-intent questions, follow-ups after a price change, unsupported requests, citation quality, and customer/staff access boundaries.

Report separate metrics for product/variant correctness, list precision and recall, current price ID/amount/unit correctness, citation correctness, clarification quality, unsupported-answer abstention, answer coverage, and p50/p95 latency. Establish a baseline before setting improvement thresholds. For every answered price case, SQL price ID, version, amount, tier, package, and unit must match exactly. Manual review remains required for recommendation quality and factual prose; automated model grading is only a signal.

Tests should include unit tests for query-plan and response-schema validation, API/service tests for retrieval routing and evidence validation, browser tests for customer/staff flows and paginated lists, isolated SQL regression for RPC/RLS behavior, and a repeatable evaluation run against a versioned corpus/model configuration. Production data changes are not part of the feature test plan.

## Failure behavior and performance

- If the chat model is unavailable, keep direct catalog search and SQL price lookup usable where the user's request can be safely handled without generation.
- If embedding/vector retrieval is unavailable, retain keyword/catalog retrieval for exact product and list requests; clearly report when document QA cannot be completed.
- Bound query-plan complexity, evidence count, response length, and page size. Batch independent retrieval only when it preserves filters and role boundaries.
- Record model/provider, corpus and price versions, timings, route, and validation outcomes without logging secrets or unnecessary personal data.

## Alternatives considered

1. **One unrestricted agent prompt:** most flexible on the surface, but mixes identity, authorization, price selection, and prose generation; difficult to guarantee complete lists or current prices.
2. **Hard-coded intent and answer templates:** predictable for known phrases, but brittle for natural language, multi-part requests, and future products; this is not the desired experience.
3. **Validated query planning plus typed evidence and flexible generation — recommended:** the model interprets varied language and composes natural answers, while deterministic application code controls retrieval, access, current prices, citations, completeness, and actions.

## Scope and rollout

Deliver P0 as a complete usable slice before recommendations. Implement the P1 capabilities only after the P0 evaluation set passes. Add feedback and repeatable evaluation as the P2 quality loop. Keep migrations additive and test them only on local or isolated databases; do not widen production permissions as a shortcut. Release readiness requires browser checks and quality results against an explicitly approved corpus, not build success alone.

## Self-review

- Flexibility applies to natural-language interpretation and answer composition; authoritative values, permissions, evidence, pagination, and actions stay application-controlled.
- Broad catalog listing cannot claim completeness from vector top-k or the existing seed-group expansion.
- Current prices are re-read for every answer and follow-up.
- Recommendation, comparison, multi-intent, anonymous context, and staff access have explicit acceptance and test coverage.
- The design does not prescribe exact sentences or an unrestricted tool-calling agent.
