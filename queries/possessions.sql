SELECT *
FROM View_PossessionsData
WHERE c_personid = :person_id
ORDER BY c_possession_yr, c_sequence
LIMIT :limit OFFSET :offset;
