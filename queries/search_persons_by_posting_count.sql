SELECT COUNT(DISTINCT po.c_personid) AS total
FROM View_PostingOfficeData po
WHERE (
  po.c_office_chn LIKE :pattern
  OR po.c_office_pinyin LIKE :pattern
  OR po.c_office_trans LIKE :pattern
)
AND (:year_min IS NULL OR po.c_lastyear IS NULL OR po.c_lastyear >= :year_min)
AND (:year_max IS NULL OR po.c_firstyear IS NULL OR po.c_firstyear <= :year_max)
AND (:dynasty_code IS NULL OR po.c_dy = :dynasty_code);
