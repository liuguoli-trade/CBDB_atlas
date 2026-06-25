SELECT *
FROM View_BiogInstData
WHERE c_personid = :person_id
ORDER BY c_bi_begin_year
LIMIT :limit OFFSET :offset;
