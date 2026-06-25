SELECT DISTINCT
  p.c_personid,
  p.c_name_chn,
  p.c_name,
  p.c_dynasty_chn,
  p.c_birthyear,
  p.c_deathyear,
  i.c_inst_name_hz,
  i.c_bi_role_chn,
  '社會機構' AS relation
FROM View_BiogInstData i
JOIN View_PeopleData p ON p.c_personid = i.c_personid
WHERE i.c_inst_name_code = :entity_id
ORDER BY p.c_name_chn
LIMIT :limit OFFSET :offset;
