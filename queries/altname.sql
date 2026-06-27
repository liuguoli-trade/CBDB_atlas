SELECT *
FROM View_AltnameData
WHERE c_personid = :person_id
ORDER BY
  CASE c_alt_name_type_code
    WHEN 18 THEN 1
    WHEN 3 THEN 2
    WHEN 9 THEN 3
    WHEN 10 THEN 4
    WHEN 12 THEN 5
    WHEN 13 THEN 6
    WHEN 4 THEN 7
    WHEN 5 THEN 8
    WHEN 7 THEN 9
    WHEN 11 THEN 10
    WHEN 8 THEN 11
    WHEN 15 THEN 12
    WHEN 14 THEN 13
    WHEN 6 THEN 14
    WHEN 19 THEN 15
    WHEN 20 THEN 16
    WHEN 16 THEN 17
    WHEN 17 THEN 18
    WHEN -1 THEN 19
    WHEN 0 THEN 20
    ELSE 21
  END,
  CASE WHEN c_sequence IS NULL THEN 1 ELSE 0 END,
  c_sequence,
  c_alt_name_chn,
  c_alt_name
LIMIT :limit OFFSET :offset;
