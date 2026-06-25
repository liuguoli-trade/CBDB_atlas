SELECT DISTINCT
  p.c_personid,
  p.c_name_chn,
  p.c_name,
  p.c_dynasty_chn,
  p.c_birthyear,
  p.c_deathyear,
  t.c_title_chn,
  t.c_role_desc_chn,
  '著述' AS relation
FROM View_BiogTextData t
JOIN View_PeopleData p ON p.c_personid = t.c_personid
WHERE t.c_textid = :entity_id
ORDER BY p.c_name_chn
LIMIT :limit OFFSET :offset;
