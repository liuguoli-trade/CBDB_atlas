SELECT
  c_addr_id,
  c_name_chn,
  c_name,
  c_admin_type,
  c_firstyear,
  c_lastyear,
  x_coord,
  y_coord,
  belongs1_Name_chn,
  belongs2_Name_chn,
  belongs3_Name_chn,
  belongs4_Name_chn,
  belongs5_Name_chn
FROM ADDRESSES
WHERE c_addr_id = :addr_id
LIMIT 1;
