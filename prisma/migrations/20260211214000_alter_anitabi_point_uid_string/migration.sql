-- Store source contributor ids as text to avoid int overflow from upstream values.
ALTER TABLE "AnitabiPoint"
  ALTER COLUMN "uid" TYPE TEXT USING CASE WHEN "uid" IS NULL THEN NULL ELSE "uid"::text END,
  ALTER COLUMN "reviewUid" TYPE TEXT USING CASE WHEN "reviewUid" IS NULL THEN NULL ELSE "reviewUid"::text END;
