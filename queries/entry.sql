SELECT *
FROM View_EntryData
WHERE c_personid = :person_id
ORDER BY c_sequence, c_year
LIMIT :limit OFFSET :offset;
