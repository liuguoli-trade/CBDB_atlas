SELECT *
FROM View_BiogSourceData
WHERE c_personid = :person_id
ORDER BY c_main_source DESC, c_title_chn
LIMIT :limit OFFSET :offset;
