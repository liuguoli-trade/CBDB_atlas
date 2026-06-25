SELECT *
FROM View_KinAddrData
WHERE c_personid = :person_id
ORDER BY c_sequence, c_kinrel_chn
LIMIT :limit OFFSET :offset;
