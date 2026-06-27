SELECT COUNT(*) AS total
FROM TEXT_CODES AS t
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
);
