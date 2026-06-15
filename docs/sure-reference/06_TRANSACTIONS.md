# 06 — Transactions & ledger backlog (Quick-Categorize · Rules · Splits · Bulk-edit/Search · Import-revert)

> Read `00_PORTING_GUIDE.md` first. wealth-os terms (paise · `+`=inflow · `user_id` · 276 taxonomy). Sure `path:line` @ `b0b0dc86…`, re-read this run. Recurring/upcoming is its own doc (`07_RECURRING.md`); privacy-blur lives in `05_UX_SHELL.md`.

These are the **post-Option-B backlog** items that operate on the transactions ledger — the screen wealth-os already has, where Sure does more. Ranked by value × fit for an import-only, single-user, INR app:

| # | Feature | Effort | Why |
|---|---|---|---|
| §1 | **Quick-Categorize wizard** + the rules engine | **S** (wizard) / **L** (full engine) | Collapses the most-repeated chore (review → categorize). Top pick. |
| §2 | **Transaction splits** | **M** | One payment, many categories — accuracy for a paise-exact app. |
| §3 | **Bulk-edit + search/filters** | **M** | Multi-select edit + rich filters; lifts the 300-row review cap. |
| §4 | **Import revert** | **M** | Undo a bad import as a unit; safety net. |

Recommended sequence after Budgets/Reports: **Quick-Categorize → splits → (recurring, `07`)**. Out of scope (not gaps): live sync, multi-user, AI assistant/MCP — see `00_PORTING_GUIDE.md`.

---

## §1 — Quick-Categorize wizard + rules engine

**Effort: Quick-Categorize S (do first) · full conditions→actions engine L.** Doubles as the rules-engine deep dive flagged in `SURE_GAP.md`.

### What it is
(a) The **Quick-Categorize wizard** — group the uncategorized queue by similar name and one-click "categorize all + make a rule." (b) A richer **conditions→actions rules engine** (compound AND/OR, several action types) that wealth-os's vendor-text→category rules could grow into.

### Sure data model
- **`rules`** (`db/schema.rb:1585-1594`): `family_id`, `resource_type` ("transaction"), `effective_date`, `active`, `name`.
- **`rule_actions`** (`:1546-1553`): `rule_id`, `action_type`, `value`.
- **`rule_conditions`** (`:1555-1565`): `rule_id`, `parent_id` (self-ref, for compound nesting), `condition_type`, `operator`, `value`.
- `RuleRun` tracks each execution. Models: `app/models/rule.rb` (+ `rule/condition.rb`, `rule/action.rb`, `rule/condition_filter/*`, `rule/action_executor/*`, `rule/registry/transaction_resource.rb`).

### Algorithm (numbered)
1. **Apply pipeline** (`rule.rb` `apply`): build a matching scope = `registry.resource_scope`, then per condition `prepare` (joins) + `apply` (WHERE); run each action over that scope; return modified-count (sync) or `{ async, modified_count, jobs_count }`. `affected_resource_count` = scope count.
2. **Resource scope** (`registry/transaction_resource.rb`): `transactions.visible` + `excluding_split_parents` + `date >= effective_date`.
3. **Conditions** (`rule/condition.rb`): a leaf delegates to its filter; a **compound** (`condition_type="compound"`, `operator ∈ {and,or}`) combines `sub_conditions`. **Max one nesting level**.
4. **8 condition filters** (`rule/condition_filter/*`): `transaction_name` (text like/=/is_null), `transaction_notes` (text), `transaction_details` (JSONB `extra`), `transaction_amount` (number `>`,`>=`,`<`,`<=`,`=` on `ABS(amount)`), `transaction_type` (income/expense/transfer), `transaction_category` (=/is_null), `transaction_merchant` (=/is_null), `transaction_account` (=/is_null).
5. **9 action executors** (`rule/action_executor/*`): `set_transaction_category/merchant/name/tags`, `set_investment_activity_label`, `exclude_transaction`, `set_as_transfer_or_payment` (sync); `auto_categorize`, `auto_detect_merchants` (**async, AI**, batched 20, only if an LLM provider is configured). Writes go through the **enrichable** layer — see `00_PORTING_GUIDE.md` §7 (respects locked/user-edited attributes).
6. **`create_from_grouping(family, grouping_key, category, transaction_type:)`** (`rule.rb:45-54`, verified): builds `name = grouping_key` + condition `transaction_name like grouping_key` + optional `transaction_type =` + action `set_transaction_category = category.id`; `rescue RecordInvalid → nil`. **The Quick-Categorize primitive.**
7. **Wizard** (`transactions/categorizes_controller.rb`): group uncategorized via `Grouper::ByMerchantOrName` (key `[merchant|name, type]`, sorted by group size desc); show one group at a time with a category picker + an optional "create rule" checkbox → rule 6; `preview_rule` uses `Entry.uncategorized_matching(entries, filter, type)`.
8. **AI-cost estimate** (`LlmUsage.estimate_auto_categorize_cost`): `prompt ≈ 150 + txn×100 + category×50`; `completion ≈ txn×50`.

### UI/UX
Rules index (sortable list + recent-runs table). Rule form: **IF** conditions (add condition / condition group, AND/OR), **THEN** actions, **FOR** date scope. Wizard: two columns — left = "create rule" panel (editable name filter, live preview) + matching txn list; right = searchable category picker; top = "N remaining" + Skip.

### ★ wealth-os build notes
wealth-os already has a simpler engine — **reuse and grow it:** `vendor_rules` (`priority`, `match_text`, `active`, `last_hit_count`) + `src/lib/ingest/rules.ts` (`normalize`, `categorize`, `reapplyRules`) + `src/components/rules-manager.tsx` + `/api/rules/{create,apply,reorder}`.
- **Phase 1 — Quick-Categorize (S, no schema change):** a `/transactions` Review action grouping `Uncategorized Review` rows by `normalize(description_raw)`, with a per-group category picker that one-click creates a `vendor_rule` (`/api/rules/create`) then applies (`/api/rules/apply`). This is rule 6 in wealth-os terms.
- **Hard guard (wealth-os invariant):** the picker + rule creation must **refuse any leaf under parent `14`/`15`** (`guardCategory` / `loadRules` refusal, `src/lib/server/rules.ts`) — only `Uncategorized Review` is the allowed fallback. Sure has no such guard; keep wealth-os's.
- **Phase 2 — richer engine (L, optional):** grow `vendor_rules` → `rules`+`rule_conditions`+`rule_actions` (paise, `user_id`, RLS). Map filters: `transaction_name`→normalized `description_raw`; `transaction_type`→sign (income `>0`/spend `<0`/transfer parent `10`); `transaction_amount`→`abs(amount_paise)` (exact); `transaction_category`→`category_id`; `transaction_notes`→`notes`. Map actions: `set_category`, `set_tags` (leakage), `exclude` — all keep the 14/15 guard.
- **AI actions:** `auto_categorize` may run **only over description text** (the existing `/api/ai/suggest` selects `id, description_raw, merchant` and nothing else) — **never amounts/dates** (the CLAUDE.md wall). Keep AI as suggest, human-confirm, unless version-bumped.
- Preserve the existing reapply **override policy** (never overwrite user-set categories) and `effective_date`.
- **`verify.ts`:** grouping deterministic; created rule idempotent on re-apply; the 14/15 refusal holds at load + create + AI-suggest; condition predicates match fixtures.

---

## §2 — Transaction splits

**Effort: M.**

### What it is
Split one transaction into categorized children that **sum exactly to the parent**. The parent is retained but excluded from aggregation; the children carry the categories.

### Sure data model
On `entries` (no extra table) — `app/models/entry.rb`: `parent_entry_id` (uuid, nullable; nil = not a child, indexed), `excluded` (bool; parents set true), `child_entries` (`:16`, `dependent: :destroy`). Predicates `:381-387`. Guards: a parent can't be un-excluded, a child's date must equal the parent's, a child can't be deleted except via `unsplit!`.

### Algorithm (numbered)
1. **Eligibility** (`transaction/splittable.rb:4-5`): `splittable? = !transfer && !split_child && !split_parent && !pending && !excluded`. → wealth-os: splittable if not a transfer (parent `10`) and not already split.
2. **`split!(splits)`** (`entry.rb:393-423`): validate `Σ child.amount == parent.amount` — **exact, no tolerance** (`:394-397`). → paise: `Σ child_paise === parent_paise` (integers ⇒ no slack).
3. **Children** (`:401-414`) inherit `account`, `date`, `currency`, `merchant`, `kind`; **category per-child**. Parent set `excluded: true` + `mark_user_modified!` (`:418-419`).
4. **Sign**: children keep the parent's sign. → wealth-os `+`=inflow: a spend parent is negative; children negative, summing to it.
5. **`unsplit!`** (`:426-434`): destroy children, parent `excluded: false`.
6. **Aggregation**: parents excluded everywhere via `excluded = true` **and** `excluding_split_parents` (`entry.rb:72-78`, `NOT EXISTS` subquery; see `00_PORTING_GUIDE.md` §8). Children counted, parents not — never both.

### UI/UX
A split modal (`split_transaction_controller.js`): rows of name/amount/category, **Add split**, and a live **Remaining** indicator (UI tolerance ±0.005) — submit disabled until 0.

### ★ wealth-os build notes
wealth-os is flat `transactions`. Add split children on the same table:
- **Migration:** `transactions.parent_txn_id uuid null` (FK self) + a `split_parent boolean not null default false`. RLS already via `user_id`.
- **`/api/transactions/split`** (re-validates like `/api/commit`): create children (inherit `account_id`, `txn_date`, `merchant`; category per child), set parent `split_parent = true`; validate `Σ child amount_paise === parent amount_paise` (exact integer).
- **Aggregation:** exclude split parents from `bucketTotals()`/`accountBalances()` (`src/lib/halan.ts`) — children sum to the same total, so the balance is unchanged. Add an `excludeSplitParents` filter to `src/lib/server/load-drill.ts`/`drilldown.ts`.
- **⚠ Dedup decision:** splits are **user-derived, not imported**. Keep the **parent** as the import dedup anchor (retains its `content_hash`, just excluded from aggregation); keep **children out of the `content_hash`/upsert path** (`src/lib/ingest/util.ts`). A re-import re-dedups the parent and must not resurrect/duplicate children.
- **`verify.ts`:** `Σ child_paise === parent_paise`; split parent excluded from `bucketTotals`/`accountBalances` while children count (net unchanged); `unsplit` restores; re-importing the source statement leaves splits intact and inserts nothing.

---

## §3 — Bulk-edit + search / filters

**Effort: M.**

### What it is
A rich **filter+search** model (text, date, amount, account, category, type, merchant, tag) plus **bulk edit** (multi-select → set category/tag in one action). Removes the 300-row review cap and the "drop into Supabase SQL" escape hatch.

### Sure data model
No new tables. `app/models/transaction/search.rb` builds the scope; `app/models/entry_search.rb` holds cross-cutting filters; `transactions/bulk_updates_controller.rb` + `entry.rb` `bulk_update!` do bulk writes. Base scope: `family.transactions.merge(Entry.excluding_split_parents)` (`search.rb:27-30`).

### Algorithm (numbered)
Filters (`transaction/search.rb` + `entry_search.rb`), applied in sequence (`search.rb:33-44`):
1. **search text** → `entries.name ILIKE %q% OR entries.notes ILIKE %q%` (`entry_search.rb:16-24`, sanitized).
2. **date** → `entries.date >= start` / `<= end`.
3. **amount + operator**: `equal` → `ABS(ABS(amount) − x) <= 0.01`; `less` → `<`; `greater` → `>`. → paise: compare `abs(amount_paise)` exactly (drop ±0.01).
4. **accounts** → name or id.
5. **categories** (`search.rb:123-161`) → `categories.name IN (…) OR categories.parent_id IN (…)`; "Uncategorized" → `category_id IS NULL AND kind NOT IN TRANSFER_KINDS`.
6. **types** (`:163-183`): income `amount<0`, expense `amount>=0`, transfer `kind IN TRANSFER_KINDS`. → **flip:** income `amount_paise>0`, spend `<0`, transfer parent `10`.
7. **merchants** / **tags** → INNER JOIN name IN.
8. **status** (pending) — n/a for wealth-os (all imported txns are posted).
9. **active_accounts_only** → `accounts.status IN (draft, active)` — n/a (wealth-os has no account status; see `00` §9).

**Persistence:** filter state in the session (`prev_transaction_page_params`), restored on return; per-badge `clear_filter` (`transactions_controller.rb:69-96, 525-568`).

**Bulk edit** (`entry.rb:446-508` `bulk_update!`):
10. Fields: `date, name, notes, category_id, merchant_id, tag_ids`.
11. `update_tags` is **opt-in** — tags change only when `tag_ids` is present (`tags_provided?`) so a blank field never clears tags.
12. **Skip `date` for split children**; skip category/merchant for non-transaction entries.
13. Each changed row → `lock_saved_attributes!` + `mark_user_modified!` (in wealth-os: protects from rule-reapply — `00` §7).

### UI/UX
A filter bar with an 8-tab filter menu (account/date/type/status/amount/category/tag/merchant), searchable multi-selects, removable badge pills. Bulk: a page-select header checkbox + per-row checkboxes (transfers disabled), a fixed bottom selection bar (N selected + Edit/Delete/Duplicate), and an edit drawer.

### ★ wealth-os build notes
- **Search/filter:** add a server-side filtered query behind `/transactions` Review (rules 1–9 in `+`=inflow terms), paginated — **lifts the 300-row cap**. Reuse `parentByCatId` for category/parent expansion (`src/lib/server/load-drill.ts`); never hardcode names.
- **Bulk edit:** extend `src/components/review-table.tsx` with multi-select + a bulk endpoint that re-validates categories (like `/api/commit`), honours the rules-reapply override policy, and applies tags only when explicitly chosen (rule 11). Reuse the existing `category-select`, leakage tag, and source/category filters.
- **`verify.ts`:** type predicate matches the wealth-os sign; a bulk update touches only selected ids and never clears tags unless `tag_ids` was sent; amount/date/text filters select the expected fixture rows.

---

## §4 — Import revert (undo a commit)

**Effort: M.**

### What it is
Roll back an entire import in one action. wealth-os commits are one-way today (dedup makes *re-import* safe, but a bad batch can't be removed wholesale).

### Sure data model
`app/models/import.rb`: `enum :status` (`:53-60`) `pending, complete, importing, reverting, revert_failed, failed`; `has_many :accounts/:entries, dependent: :destroy` (`:80-81`), linked by `import_id` (+ `entries.import_locked`).

### Algorithm (numbered)
1. **`revertable?`** (`import.rb:313-315`) = `complete? || revert_failed?`.
2. **`revert_later`** (`:161-167`): guard, status `:reverting`, enqueue `RevertImportJob`.
3. **`revert`** (`:169-180`), one DB transaction: `accounts.destroy_all` then `entries.destroy_all` (rows with this `import_id`); `family.sync_later`; status → `:pending` (or `:revert_failed` on error — idempotent retry allowed).
4. **Not reverted:** pre-existing rows (`import_id IS NULL`). A *claimed/deduped* entry gets stamped `import_id` and **is** destroyed.
5. **Re-import after revert:** import metadata preserved; re-running re-dedups and re-inserts — idempotent.

### ★ wealth-os build notes
wealth-os already stamps `transactions.import_id` (`0001_init.sql`) + stores `imports` — no new table.
- **Revert = delete `transactions WHERE import_id = X AND user_id = auth.uid()`** in a transaction, then recompute. Also drop import-tied `holdings_snapshots`/`realized_gain_*` rows.
- **⚠ Key difference from Sure:** Sure also destroys *accounts the import created*. **wealth-os accounts are user-created** — so **do NOT delete accounts**, only the import's transactions.
- **Anchor re-derivation:** if the reverted import was the **earliest** for an account, recompute `anchor_balance_paise`/`anchor_date` from the next-earliest import; clear if it was the only one.
- **Route:** `/api/imports/[id]/revert` (re-validates ownership); a "Revert import" button on `/accounts` or an imports list.
- **`verify.ts`:** revert removes exactly that `import_id`'s rows; anchor re-derived when the earliest import is reverted; re-importing the same statement re-inserts the same rows (idempotent end-to-end).
