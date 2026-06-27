SELECT *
FROM View_KinAddrData
WHERE c_personid = :person_id
ORDER BY
  CASE
    WHEN c_upstep > 0 AND c_dwnstep = 0 THEN 0
    WHEN c_upstep = 0 AND c_dwnstep = 0 THEN 1
    WHEN c_dwnstep > 0 THEN 2
    ELSE 3
  END,
  CASE
    WHEN c_upstep > 0 AND c_dwnstep = 0 THEN -c_upstep
    WHEN c_dwnstep > 0 THEN c_dwnstep
    ELSE (c_colstep + c_marstep)
  END,
  CASE
    WHEN c_marstep = 0 AND c_colstep = 0 AND (c_upstep > 0 OR c_dwnstep > 0) THEN 0
    WHEN c_marstep = 0 AND c_colstep > 0 THEN 1
    ELSE 2
  END,
  c_colstep,
  c_marstep,
  c_pick_sorting,
  c_kinrel_chn,
  c_kin_id
LIMIT :limit OFFSET :offset;
