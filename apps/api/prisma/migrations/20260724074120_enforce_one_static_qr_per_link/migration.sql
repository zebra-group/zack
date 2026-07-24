-- Enforce "at most one static QR code per Link" at the DATABASE layer
-- (WR-09, 260724-d72-PLAN.md). Previously this invariant was only checked by
-- application/frontend logic (07-09's LinkDetailView client-side filter) -
-- there was no server-side guarantee, so a direct API call or a race between
-- two concurrent POSTs could create two static QR codes for the same Link.
--
-- This migration is purely additive/backward-compatible: it adds ONE partial
-- unique index (no column or data change). It deliberately does NOT touch
-- dynamic QrCode rows - those keep their own `code @unique` and MAY share a
-- linkId with any number of other dynamic QrCode rows.

-- Backward-compatibility guard: since the invariant was previously enforced
-- only client-side, pre-existing duplicate static QR codes for the same
-- linkId are possible (if unlikely). Creating the partial unique index below
-- against such data would otherwise fail with a cryptic Postgres error
-- ("could not create unique index ... is duplicated"). Fail fast here with
-- an actionable message instead, and NEVER delete/modify any row.
DO $$
DECLARE
  duplicate_link_ids TEXT;
BEGIN
  SELECT string_agg("linkId", ', ')
  INTO duplicate_link_ids
  FROM (
    SELECT "linkId"
    FROM "QrCode"
    WHERE "variant" = 'static'
    GROUP BY "linkId"
    HAVING count(*) > 1
  ) AS dup;

  IF duplicate_link_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot apply migration enforce_one_static_qr_per_link: Link(s) [%] have more than one static QrCode. Resolve the duplicate static QR codes for these Links before re-running this migration.', duplicate_link_ids;
  END IF;
END $$;

-- CreateIndex
-- The authoritative one-static-QR-per-link guarantee. Prisma's `@@unique`
-- cannot express a `WHERE` condition, so this partial unique index is
-- hand-authored raw SQL (see schema.prisma's QrCode model comment).
CREATE UNIQUE INDEX "QrCode_linkId_static_key" ON "QrCode"("linkId") WHERE "variant" = 'static';
