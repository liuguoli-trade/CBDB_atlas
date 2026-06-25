SELECT DISTINCT
  p.c_personid,
  p.c_name_chn,
  p.c_name,
  p.c_dynasty_chn,
  p.c_birthyear,
  p.c_deathyear,
  po.c_office_chn,
  po.c_firstyear,
  po.c_lastyear,
  '任官' AS relation
FROM View_PostingOfficeData po
JOIN View_PeopleData p ON p.c_personid = po.c_personid
WHERE po.c_office_id = :entity_id
ORDER BY po.c_firstyear DESC, p.c_name_chn
LIMIT :limit OFFSET :offset;
