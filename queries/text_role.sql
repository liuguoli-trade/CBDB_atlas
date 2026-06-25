SELECT *
FROM View_BiogTextData
WHERE c_personid = :person_id
ORDER BY c_year, c_title_chn
LIMIT :limit OFFSET :offset;
