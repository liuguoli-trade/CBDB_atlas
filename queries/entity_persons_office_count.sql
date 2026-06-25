SELECT COUNT(DISTINCT po.c_personid) AS total
FROM View_PostingOfficeData po
WHERE po.c_office_id = :entity_id;
