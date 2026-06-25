SELECT COUNT(*) AS total
FROM OFFICE_CODES
WHERE (
  c_office_chn LIKE :pattern
  OR c_office_pinyin LIKE :pattern
  OR c_office_trans LIKE :pattern
  OR c_office_chn_alt LIKE :pattern
  OR CAST(c_office_id AS TEXT) = :exact_id
);
