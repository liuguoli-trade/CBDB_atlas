SELECT *
FROM View_EventData
WHERE c_personid = :person_id
ORDER BY c_year, c_sequence
LIMIT :limit OFFSET :offset;
