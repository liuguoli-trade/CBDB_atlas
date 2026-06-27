SELECT
  a.c_addr_id,
  a.c_name_chn,
  a.c_alt_names,
  (
    SELECT CASE
      WHEN :dynasty_code IS NOT NULL THEN (
        SELECT d.c_dynasty_chn
        FROM DYNASTIES AS d
        WHERE d.c_dy = :dynasty_code
        LIMIT 1
      )
      WHEN (
        SELECT s.c_dynasty_chn
        FROM DYNASTIES AS s
        WHERE a.c_firstyear IS NOT NULL
          AND a.c_firstyear >= COALESCE(s.c_start, -9999)
          AND a.c_firstyear <= COALESCE(s.c_end, 9999)
        ORDER BY s.c_sort DESC
        LIMIT 1
      ) IS NOT NULL
      AND (
        SELECT e.c_dynasty_chn
        FROM DYNASTIES AS e
        WHERE a.c_lastyear IS NOT NULL
          AND a.c_lastyear >= COALESCE(e.c_start, -9999)
          AND a.c_lastyear <= COALESCE(e.c_end, 9999)
        ORDER BY e.c_sort DESC
        LIMIT 1
      ) IS NOT NULL
      AND (
        SELECT s.c_dynasty_chn
        FROM DYNASTIES AS s
        WHERE a.c_firstyear IS NOT NULL
          AND a.c_firstyear >= COALESCE(s.c_start, -9999)
          AND a.c_firstyear <= COALESCE(s.c_end, 9999)
        ORDER BY s.c_sort DESC
        LIMIT 1
      ) <> (
        SELECT e.c_dynasty_chn
        FROM DYNASTIES AS e
        WHERE a.c_lastyear IS NOT NULL
          AND a.c_lastyear >= COALESCE(e.c_start, -9999)
          AND a.c_lastyear <= COALESCE(e.c_end, 9999)
        ORDER BY e.c_sort DESC
        LIMIT 1
      )
      THEN (
        SELECT s.c_dynasty_chn
        FROM DYNASTIES AS s
        WHERE a.c_firstyear IS NOT NULL
          AND a.c_firstyear >= COALESCE(s.c_start, -9999)
          AND a.c_firstyear <= COALESCE(s.c_end, 9999)
        ORDER BY s.c_sort DESC
        LIMIT 1
      ) || '–' || (
        SELECT e.c_dynasty_chn
        FROM DYNASTIES AS e
        WHERE a.c_lastyear IS NOT NULL
          AND a.c_lastyear >= COALESCE(e.c_start, -9999)
          AND a.c_lastyear <= COALESCE(e.c_end, 9999)
        ORDER BY e.c_sort DESC
        LIMIT 1
      )
      ELSE COALESCE(
        (
          SELECT s.c_dynasty_chn
          FROM DYNASTIES AS s
          WHERE a.c_firstyear IS NOT NULL
            AND a.c_firstyear >= COALESCE(s.c_start, -9999)
            AND a.c_firstyear <= COALESCE(s.c_end, 9999)
          ORDER BY s.c_sort DESC
          LIMIT 1
        ),
        (
          SELECT e.c_dynasty_chn
          FROM DYNASTIES AS e
          WHERE a.c_lastyear IS NOT NULL
            AND a.c_lastyear >= COALESCE(e.c_start, -9999)
            AND a.c_lastyear <= COALESCE(e.c_end, 9999)
          ORDER BY e.c_sort DESC
          LIMIT 1
        )
      )
    END
  ) AS c_dynasty_chn,
  (
    SELECT p.c_name_chn
    FROM ADDR_BELONGS_DATA AS b
    JOIN ADDR_CODES AS p ON p.c_addr_id = b.c_belongs_to
    WHERE b.c_addr_id = a.c_addr_id
    ORDER BY b.c_lastyear DESC, b.c_firstyear DESC
    LIMIT 1
  ) AS c_parent_addr_chn,
  (
    SELECT GROUP_CONCAT(sub.c_name_chn, '、')
    FROM (
      SELECT DISTINCT ch.c_name_chn
      FROM ADDR_BELONGS_DATA AS b
      JOIN ADDR_CODES AS ch ON ch.c_addr_id = b.c_addr_id
      WHERE b.c_belongs_to = a.c_addr_id
      ORDER BY ch.c_name_chn
      LIMIT 12
    ) AS sub
  ) AS c_child_addrs_chn,
  a.c_firstyear,
  a.c_lastyear,
  COALESCE(
    (
      SELECT d.c_sort
      FROM DYNASTIES AS d
      WHERE a.c_firstyear IS NOT NULL
        AND a.c_firstyear >= COALESCE(d.c_start, -9999)
        AND a.c_firstyear <= COALESCE(d.c_end, 9999)
      ORDER BY d.c_sort
      LIMIT 1
    ),
    (
      SELECT d.c_sort
      FROM DYNASTIES AS d
      WHERE a.c_lastyear IS NOT NULL
        AND a.c_lastyear >= COALESCE(d.c_start, -9999)
        AND a.c_lastyear <= COALESCE(d.c_end, 9999)
      ORDER BY d.c_sort
      LIMIT 1
    ),
    9999
  ) AS _sort_dynasty
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
AND (:lastyear IS NULL OR a.c_lastyear = :lastyear)
ORDER BY
  _sort_dynasty,
  COALESCE(a.c_firstyear, 9999),
  COALESCE(a.c_lastyear, 9999),
  a.c_name_chn,
  a.c_addr_id
LIMIT :limit OFFSET :offset;
