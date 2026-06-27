SELECT COUNT(*) AS total
FROM ADDR_CODES AS a
WHERE (
  a.c_name_chn LIKE :pattern
  OR a.c_name LIKE :pattern
  OR a.c_alt_names LIKE :pattern
  OR CAST(a.c_addr_id AS TEXT) = :exact_id
)
AND (
  :dynasty_code IS NULL
  OR EXISTS (
    SELECT 1
    FROM DYNASTIES AS d
    WHERE d.c_dy = :dynasty_code
      AND COALESCE(a.c_lastyear, 9999) >= COALESCE(d.c_start, -9999)
      AND COALESCE(a.c_firstyear, -9999) <= COALESCE(d.c_end, 9999)
  )
)
AND (:firstyear IS NULL OR a.c_firstyear = :firstyear)
AND (:lastyear IS NULL OR a.c_lastyear = :lastyear);
