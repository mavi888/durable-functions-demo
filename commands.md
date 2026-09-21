# Invoke the function twice to get the order paid 2 times

aws lambda invoke \
  --function-name ldf-order-processor \
  --cli-binary-format raw-in-base64-out \
  --payload '{"order_id":"ORD-003","customer_id":"CUST-456","items":[{"item_id":"abc","quantity":1,"price":50}],"total_amount":50}' \
  response.json
