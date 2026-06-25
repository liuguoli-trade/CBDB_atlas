SELECT
  c_textid,
  c_title_chn,
  c_title,
  c_title_trans,
  c_text_year
FROM TEXT_CODES
WHERE (
  c_title_chn LIKE :pattern
  OR c_title LIKE :pattern
  OR c_title_trans LIKE :pattern
  OR CAST(c_textid AS TEXT) = :exact_id
)
ORDER BY
  CASE WHEN c_title_chn = :exact THEN 0
       WHEN c_title_chn LIKE :exact_prefix THEN 1
       ELSE 2 END,
  c_title_chn
LIMIT :limit OFFSET :offset;
