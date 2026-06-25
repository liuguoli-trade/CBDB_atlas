SELECT c_personid AS canonical_id
FROM MERGED_PERSON_DATA
WHERE c_merged_from_personid = :person_id
LIMIT 1;
