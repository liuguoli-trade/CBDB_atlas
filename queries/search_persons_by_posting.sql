SELECT DISTINCT
  p.c_personid,
  p.c_name_chn,
  p.c_name,
  p.c_dynasty_chn,
  p.c_birthyear,
  p.c_deathyear,
  po.c_office_chn,
  po.c_firstyear,
  po.c_lastyear
FROM View_PostingOfficeData po
JOIN View_PeopleData p ON p.c_personid = po.c_personid
WHERE (
  po.c_office_chn LIKE :pattern
  OR po.c_office_pinyin LIKE :pattern
  OR po.c_office_trans LIKE :pattern
)
AND (:year_min IS NULL OR po.c_lastyear IS NULL OR po.c_lastyear >= :year_min)
AND (:year_max IS NULL OR po.c_firstyear IS NULL OR po.c_firstyear <= :year_max)
AND (:dynasty_code IS NULL OR po.c_dy = :dynasty_code)
ORDER BY po.c_firstyear DESC, p.c_name_chn
LIMIT :limit OFFSET :offset;
