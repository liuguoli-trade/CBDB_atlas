SELECT COUNT(*) AS total
FROM TEXT_CODES
WHERE (
  c_title_chn LIKE :pattern
  OR c_title LIKE :pattern
  OR c_title_trans LIKE :pattern
  OR CAST(c_textid AS TEXT) = :exact_id
);
