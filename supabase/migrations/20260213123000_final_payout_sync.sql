-- Final update to mark payouts as PAID after successful on-chain execution
-- Transactions were manually verified via edge function response

UPDATE cashout_payouts
SET status = 'paid',
    tx_hash = '0x9a795169904dc633dad45075c644762b13b7cf45045e666fe6d0b981fa45a628'
WHERE id = 'cbbf453d-5b2f-449c-b07d-02e8a657d144';

UPDATE cashout_payouts
SET status = 'paid',
    tx_hash = '0xac20a4a8b6d8ff48fe0aeb74d0fd5c4ee3ed09498c258dc506a408c8202dc21d'
WHERE id = '9d200f2b-718e-4ab1-839f-6975f8a00e8c';

UPDATE cashout_payouts
SET status = 'paid',
    tx_hash = '0x9f7777d5395e110642de3d749473a2ca4d0170b276d8b3a0254faafa38bf5492'
WHERE id = '407defc8-d8a3-4b51-b139-e893f3e2b46b';

-- Also ensure the associated requests are marked as PAID
UPDATE cashout_requests
SET status = 'paid'
WHERE id IN (
  '797ac679-4243-4a33-968e-3179c77e817e',
  'b0f155c9-e106-4ad1-970f-05a8fed1b319',
  'e885bf0e-68bc-4b46-94bb-bc0c4daf12b3'
);
