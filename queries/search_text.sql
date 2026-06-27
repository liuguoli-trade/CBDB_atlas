SELECT
  t.c_textid,
  t.c_title_chn,
  t.c_title_alt_chn,
  (
    SELECT GROUP_CONCAT(line, '；')
    FROM (
      SELECT
        p.c_name_chn || '（' || COALESCE(NULLIF(tr.c_role_desc_chn, ''), '未詳') || '）' AS line
      FROM BIOG_TEXT_DATA AS btd
      INNER JOIN BIOG_MAIN AS p ON p.c_personid = btd.c_personid
      LEFT JOIN TEXT_ROLE_CODES AS tr ON tr.c_role_id = btd.c_role_id
      WHERE btd.c_textid = t.c_textid
        AND btd.c_personid > 0
        AND p.c_name_chn IS NOT NULL
        AND TRIM(p.c_name_chn) != ''
      ORDER BY
        CASE btd.c_role_id
          WHEN 1 THEN 1
          WHEN 3 THEN 2
          WHEN 2 THEN 3
          WHEN 7 THEN 4
          WHEN 8 THEN 5
          WHEN 9 THEN 6
          WHEN 10 THEN 7
          WHEN 4 THEN 8
          WHEN 5 THEN 9
          ELSE 99
        END,
        p.c_name_chn
    )
  ) AS c_responsible_persons,
  tt.c_text_type_desc_chn,
  (
    SELECT CASE
      WHEN siku.bu IS NOT NULL AND siku.xiao IS NOT NULL AND siku.bu != siku.xiao
        THEN siku.bu || '-' || siku.xiao
      WHEN siku.bu IS NOT NULL
        AND NULLIF(TRIM(bc.c_text_cat_desc_chn), '') IS NOT NULL
        AND bc.c_text_cat_desc_chn != siku.bu
        AND siku.xiao IS NULL
        THEN siku.bu || '-' || bc.c_text_cat_desc_chn
      WHEN siku.bu IS NOT NULL THEN siku.bu
      WHEN siku.xiao IS NOT NULL THEN siku.xiao
      ELSE bc.c_text_cat_desc_chn
    END
    FROM (
      WITH RECURSIVE
      type_source(type_code) AS (
        SELECT COALESCE(
          CASE
            WHEN t.c_text_type_id IS NOT NULL
              AND TRIM(t.c_text_type_id) != ''
              AND t.c_text_type_id NOT IN ('0', '01')
              THEN t.c_text_type_id
          END,
          (
            SELECT
              COALESCE(
                (
                  SELECT '0' || SUBSTR(r.c_text_cat_type_id, 3, 3) || SUBSTR(r.c_text_cat_type_id, 6, 2)
                  FROM TEXT_BIBLCAT_CODE_TYPE_REL AS r
                  WHERE r.c_text_cat_code = t.c_bibl_cat_code
                    AND EXISTS (
                      SELECT 1
                      FROM TEXT_TYPE AS tt2
                      WHERE tt2.c_text_type_code = '0' || SUBSTR(r.c_text_cat_type_id, 3, 3) || SUBSTR(r.c_text_cat_type_id, 6, 2)
                    )
                ),
                (
                  SELECT '0' || SUBSTR(r.c_text_cat_type_id, 3, 3)
                  FROM TEXT_BIBLCAT_CODE_TYPE_REL AS r
                  WHERE r.c_text_cat_code = t.c_bibl_cat_code
                    AND EXISTS (
                      SELECT 1
                      FROM TEXT_TYPE AS tt2
                      WHERE tt2.c_text_type_code = '0' || SUBSTR(r.c_text_cat_type_id, 3, 3)
                    )
                )
              )
          )
        )
      ),
      chain AS (
        SELECT
          ty.c_text_type_code,
          ty.c_text_type_desc_chn,
          ty.c_text_type_parent_id,
          ty.c_text_type_level,
          0 AS depth
        FROM TEXT_TYPE AS ty
        INNER JOIN type_source AS src ON ty.c_text_type_code = src.type_code
        WHERE src.type_code IS NOT NULL
        UNION ALL
        SELECT
          p.c_text_type_code,
          p.c_text_type_desc_chn,
          p.c_text_type_parent_id,
          p.c_text_type_level,
          chain.depth + 1
        FROM TEXT_TYPE AS p
        INNER JOIN chain ON p.c_text_type_code = chain.c_text_type_parent_id
        WHERE chain.c_text_type_parent_id IS NOT NULL
          AND chain.c_text_type_parent_id != '0'
      )
      SELECT
        (SELECT c_text_type_desc_chn FROM chain WHERE c_text_type_level = 1 LIMIT 1) AS bu,
        (SELECT c_text_type_desc_chn FROM chain WHERE c_text_type_level = 2 LIMIT 1) AS xiao
    ) AS siku
  ) AS c_text_cat_desc_chn,
  d.c_dynasty_chn,
  t.c_text_year,
  t.c_text_nh_year,
  nh.c_nianhao_chn,
  yr.c_range_chn,
  e.c_extant_desc_chn
FROM TEXT_CODES AS t
LEFT JOIN TEXT_TYPE AS tt ON tt.c_text_type_code = t.c_text_type_id
LEFT JOIN TEXT_BIBLCAT_CODES AS bc ON bc.c_text_cat_code = t.c_bibl_cat_code
LEFT JOIN DYNASTIES AS d ON d.c_dy = t.c_text_dy
LEFT JOIN EXTANT_CODES AS e ON e.c_extant_code = t.c_extant
LEFT JOIN NIAN_HAO AS nh ON nh.c_nianhao_id = t.c_text_nh_code
LEFT JOIN YEAR_RANGE_CODES AS yr ON yr.c_range_code = t.c_text_range_code
WHERE (
  t.c_title_chn LIKE :pattern
  OR t.c_title LIKE :pattern
  OR t.c_title_trans LIKE :pattern
  OR t.c_title_alt_chn LIKE :pattern
  OR CAST(t.c_textid AS TEXT) = :exact_id
)
AND (:dynasty_code IS NULL OR t.c_text_dy = :dynasty_code)
AND (
  :related_person_pattern IS NULL
  OR EXISTS (
    SELECT 1
    FROM BIOG_TEXT_DATA AS btd
    INNER JOIN BIOG_MAIN AS p ON p.c_personid = btd.c_personid
    WHERE btd.c_textid = t.c_textid
      AND (
        p.c_name_chn LIKE :related_person_pattern
        OR p.c_name LIKE :related_person_pattern
        OR p.c_surname_chn LIKE :related_person_pattern
        OR p.c_mingzi_chn LIKE :related_person_pattern
      )
  )
)
ORDER BY
  CASE WHEN t.c_title_chn = :exact THEN 0
       WHEN t.c_title_chn LIKE :exact_prefix THEN 1
       ELSE 2 END,
  COALESCE(d.c_sort, 9999),
  CASE
    WHEN t.c_text_type_id LIKE '0101%' THEN 1
    WHEN t.c_text_type_id LIKE '0102%' THEN 2
    WHEN t.c_text_type_id LIKE '0103%' THEN 3
    WHEN t.c_text_type_id LIKE '0104%' THEN 4
    WHEN t.c_text_type_id LIKE '0105%' THEN 5
    WHEN t.c_text_type_id LIKE '01%' THEN 6
    ELSE 99
  END,
  COALESCE(NULLIF(TRIM(t.c_title), ''), t.c_title_chn) COLLATE NOCASE,
  t.c_textid
LIMIT :limit OFFSET :offset;
