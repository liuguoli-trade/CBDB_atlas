SELECT *
FROM View_StatusData
WHERE c_personid = :person_id
ORDER BY c_sequence
LIMIT :limit OFFSET :offset;
