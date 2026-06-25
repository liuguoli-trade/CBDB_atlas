SELECT COUNT(*) AS total
FROM SOCIAL_INSTITUTION_NAME_CODES
WHERE (
  c_inst_name_hz LIKE :pattern
  OR c_inst_name_py LIKE :pattern
  OR CAST(c_inst_name_code AS TEXT) = :exact_id
);
