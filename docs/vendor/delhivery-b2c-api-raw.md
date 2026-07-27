# Delhivery B2C API — captured reference

Source: https://one.delhivery.com/developer-portal/documents/b2c (crawled 2026-07-27).
The portal is a JS-rendered SPA, so this file is the rendered text of every page,
lightly cleaned. **It is a snapshot, not the live contract** — re-crawl before
trusting a detail that money or a customer promise depends on.

Per-page source URLs are given under each heading.



---

## over_view

<https://one.delhivery.com/developer-portal/document/b2c/detail/over_view>

Overview

Overview
This section provides an overview of the Delhivery B2C API, enabling seamless integration for business-to-consumer logistics solutions.
Welcome to the Delhivery B2C Transportation API Documentation!
Our API suite is designed to provide businesses with reliable, efficient logistics solutions for consumer deliveries. With our APIs, you can integrate directly with Delhivery's platform to manage your entire shipping process—from order placement to delivery.
Delhivery Transportation Process Overview
Our logistics process for B2C shipments includes First-mile pickup, Mid-Mile connectivity, and Last-mile delivery:
First-Mile Pickup: We collect shipments from your warehouse or designated location, ensuring timely pickups to initiate the delivery process.
Mid-Mile Connectivity: Shipments are transported through Delhivery’s network to our distribution centers for sorting and consolidation, optimizing routes for cost-effective delivery.
Last-Mile Delivery: The shipment is delivered to the consumer's doorstep via our extensive delivery network, ensuring fast and secure delivery.
Who Can Use The APIs?

These APIs are tailored for e-commerce platforms, retailers, and businesses that need efficient and automated management of consumer deliveries. They are ideal for businesses handling high volumes of shipments across various regions.

Why Use Delhivery B2C APIs?
Interoperability: Seamless data exchange between systems, regardless of the technology used.
Efficiency: Automated processes that reduce manual work and improve overall efficiency.
Scalability: Capable of handling increased shipment volumes without major infrastructure changes.
Flexibility: Easily adaptable to changing business needs and processes.
Cost-Effectiveness: Reduced development costs through reusable services.
Security: Strong authentication and data protection protocols for secure operations.
End-to-End Solutions: Coverage of the entire logistics journey, from pickup to delivery.
What to Expect in This Document?

This documentation provides a complete guide to integrating with Delhivery B2C APIs, including:

Terminology: Definitions of key terms related to B2C logistics.
Integration Steps: A step-by-step guide to integrating the APIs with your system.
Key APIs: Detailed descriptions of available APIs, including shipment creation, tracking, and delivery endpoints.


---

## common_use_terminology

<https://one.delhivery.com/developer-portal/document/b2c/detail/common_use_terminology>

Common Used Terminology

Common Used Terminologies
This section explains commonly used terminologies to help you navigate Delhivery’s B2C API documentation with ease.

It provides a glossary of key terms and abbreviations frequently encountered in Delhivery’s B2C Transportation API documentation. To ensure clear communication and understanding when integrating with Delhivery’s system, below is a list of commonly used terms in API references, along with their descriptions.

TERMINOLOGY	DESCRIPTION
Waybill	Waybill number refers to the tracking number which is unique for each physical box.
Master waybill	In the B2C MPS order, one waybill is considered a master waybill, and the remaining are considered child waybills.
E-Waybiill	An E-waybill is an electronic document required in India for the movement of goods under GST, containing shipment details for tax compliance. this is required for the shipments having invoice value >50k.
Pickup location	The pickup location is the client's warehouse location from where the shipments will be picked up by the Delhivery FE
API token	The API token is an authentication token to authenticate the API requests. For B2C, this is a static token
POD	A document or electronic confirmation that the consignee received the shipment. It can be a signature, image, or other form of proof.
MPS	Multi-Piece Shipment
HQ Name	Delhivery Registered Account Name


---

## package-lifecycle

<https://one.delhivery.com/developer-portal/document/b2c/detail/package-lifecycle>

Package Lifecycle

Package Lifecycle
This section outlines the package lifecycle for B2C shipments, detailing each stage of a shipment's journey within Delhivery's logistics network.

In the context of B2C logistics, the package lifecycle captures the series of stages a shipment goes through from order creation to successful delivery or potential return. Each stage in this lifecycle is crucial to ensuring efficient, secure, and timely delivery for individual consumers.
Once a package is created in the Delhivery system (either via the Manifest API or the Delhivery ONE Panel), it enters a standardized package cycle to reach its end destination. The B2C package lifecycle offers visibility into each phase, allowing businesses and consumers alike to monitor shipments in real time for transparency and accuracy.

B2C Package Lifecycle Journey Types:

Picking up products from client warehouses and delivering them to end customer or back to the origin.

STATUS TYPE	STATUS	DESCRIPTION
UD	Manifested	When forward shipment's soft data is API pushed/manually uploaded to HQ from client's system
UD	Not Picked	When Shipment is not physically Picked up from Client's Warehouse
UD	In Transit	When a forward consignment is in transit to its DC after physical pick up
UD	Pending	When a forward shipment has reached DC but not yet dispatched for delivery
UD	Dispatched	When a forward shipment is dispatched for delivery to end customer
DL	Delivered	When a forward shipment is accepted by the end customer

In the forward shipment, when the shipment is either cancelled by the client/seller in the journey

STATUS TYPE	STATUS	DESCRIPTION
RT	In Transit	When forward shipment is converted in to Return shipment after unsucessfull delivery/client's Instruction/adhoc requests or conditions's system
RT	Pending	When a shipment has reached DC nearest to Origin center.
RT	Dispatched	When a shipment has reached DC nearest to Origin center and dispatched for delivery
DL	RTO	When a forward shipment is returned to Origin
Forward Journey:

i have This journey begins when the shipment is picked up from the seller’s location or warehouse and progresses toward the consumer’s doorstep. Multiple phases mark this journey, including first-mile pickup, transit, and last-mile delivery. Delhivery’s tracking system ensures that each stage is accurately logged, with real-time updates on the package’s status to keep the consumer informed.

Return Journey:

If a shipment cannot be delivered—due to factors like an incorrect address, recipient unavailability, or order cancellation—the package enters the return journey. This involves rerouting the package back to the seller’s warehouse or a designated return center, ensuring careful handling and visibility through each phase.

Reverse:

This journey is initiated when a shipment needs to be collected from the consignee, usually when a customer initiates a return request. It follows a similar process to the forward journey, including first-mile pickup, mid-mile transit, and final delivery back to the seller’s warehouse or returns facility. Delhivery’s tracking system ensures visibility at every stage, providing updates on the package’s status throughout the return process.

The different status and status types which is applied to a package when picking up shipments from customer location and delivering it to client warehouse.

STATUS TYPE	STATUS	DESCRIPTION
PP	Open	When the reverse pickup request is successfully created and registered in the system.
PP	Scheduled	When the pickup from the customer's location has been scheduled.
PP	Dispatched	When the field executive is dispatched to pick up the shipment from the customer.
PU	In Transit	When the reverse consignment has been picked up and is in transit to the facility.
PU	Pending	When the reverse shipment has reached the origin DC but is not yet dispatched to the client.
PU	Dispatched	When the reverse shipment is dispatched for delivery back to the client warehouse.
DL	DTO	Delivered To Origin; when the reverse shipment is successfully delivered back to the client.
CN	Canceled	When the reverse shipment is cancelled by the client/seller in the journey.
CN	Closed	When the reverse shipment request is closed by the client/seller.
Replacement / Buyback:

This journey begins when a customer initiates a replacement request with the client, prompting the client to create a replacement order via the order creation API. The process involves picking up the original shipment from the client location for delivery to the end customer, while simultaneously retrieving the replacement shipment from the customer and returning it to the client. This shipment's life cycle includes both forward and reverse flows, ensuring end-to-end tracking and visibility throughout.

The different status and status types which are applied to a package during a simultaneous forward delivery to the end customer and reverse pickup back to the client warehouse.

STATUS TYPE	STATUS	DESCRIPTION
UD	Manifested	When forward shipment's soft data is API pushed/manually uploaded to HQ from client's system
UD	In Transit	When a forward consignment is in transit to its DC after physical pick up
UD	Pending	When a forward shipment has reached DC but not yet dispatched for delivery
UD	Dispatched	When a forward shipment is dispatched for delivery to end customer
PU	In Transit	When the reverse consignment has been picked up and is in transit to the facility
PU	Pending	When the reverse shipment has reached the origin DC but is not yet dispatched to the client
PU	Dispatched	When the reverse shipment is dispatched for delivery back to the client warehouse
DL	DTO	Delivered To Origin; when the reverse shipment is successfully delivered back to the client
RT	In Transit	When forward shipment is converted in to Return shipment after unsuccessful delivery/client's Instruction/adhoc requests or conditions's system
RT	Pending	When a shipment has reached DC nearest to Origin center.
RT	Dispatched	When a shipment has reached DC nearest to Origin center and dispatched for delivery
DL	RTO	When a forward shipment is returned to Origin
Key Stages in a B2C Package Lifecycle:
Order Creation: The journey starts when a shipment order is created in Delhivery’s system via API or the Delhivery ONE Panel.
First-Mile Pickup: Delhivery’s team picks up the package from the seller’s warehouse or designated pickup location.
Mid-Mile Transit: The package moves through various hubs within Delhivery's network as it heads toward the delivery city.
Last-Mile Delivery: The final step in the forward journey, where the package is delivered directly to the consumer..
Return Process (if applicable): If delivery fails, the package enters the return journey, passing through similar transit phases back to the origin.
Lost: In cases when the shipment is lost during transit.
Payment Modes for B2C Orders: 

For Delhivery’s B2C shipments, the following four payment methods are available:

Prepaid:  The consignee pays for the order upfront at the time of purchase
Cash on Delivery (COD)::  The consignee pays for the shipment upon delivery.
Pickup:  This payment mode is specifically for the Reverse shipments (RVP), where the shipment is picked up from the consignee and shipped back to the seller's warehouse or pickup location
Replacement (REPL):  When a customer requests a replacement from the client, leading to the creation of a new order through the order creation API, the REPL Payment method is used.

Throughout the package lifecycle, Delhivery provides end-to-end visibility into each stage, ensuring that both businesses and consumers can track and manage their orders effectively. From order creation to final delivery, or return if necessary, Delhivery’s comprehensive package lifecycle management guarantees a reliable and transparent process, tailored for B2C needs.


---

## integration-steps

<https://one.delhivery.com/developer-portal/document/b2c/detail/integration-steps>

Steps of Integration for B2C Shipments

Steps of Integration for B2C Shipments
This guide outlines the steps to integrate with Delhivery’s B2C API for efficient logistics management.
1.  API Keys

Obtain your API key either from your Delhivery account point of contact (POC) or by logging into the One Panel. Navigate to: Settings > API Setup > Existing API Token > View/Copy

2.  Fetch Waybill

Use the Bulk Waybill API to fetch waybill numbers in advance, required only where orders creation is required with pre-assigned waybills

3.  Serviceability and TAT

Before creating shipments, check the serviceability of the pincode using the Pincode Serviceability API. Use the TAT API to get the estimated TAT between the origin and destination pincode pair.

4.  Warehouse Setup

Register your warehouse or pickup location using the Warehouse Creation API. For any updates, use the Warehouse Updation API.

5.  Shipping Cost Calculation

Get the estimated shipping charges using the Shipping Cost API.

6.  Shipment Creation

Create the shipments using the Shipment Creation API.

7.  Shipment Update and Cancellation

If needed, update shipment details using the Shipment Update API. To cancel the shipment, use the Shipment Cancellation API before the shipment is dispatched.

8.  Pickup Request Creation

Create a pickup request for the Delhivery operations team using the PUR Creation API.

9.  Shipping Label Generation

Generate a shipping label using the Shipping Label API.

10.  Shipment Tracking

Track the shipment statuses using the Track API.

11.  Download Document

Download the relevant documents using Document Download API , like POD’s, QC images, etc


---

## pincode-serviceability

<https://one.delhivery.com/developer-portal/document/b2c/detail/pincode-serviceability>

B2C Pincode Serviceability

B2C Pincode Serviceability
This API provides the serviceability of the consignee's pin code.
This API will provide visibility on whether a Pincode is serviceable or not.
If any pin code is serviceable only then order creation or any further API needs to be used.
If the API response is an empty list, the pincode is non-serviceable (NSZ).
If filter_code is not passed, the API returns both serviceable and embargoed pincodes.
In the response, remark as "Embargo" indicates temporary NSZ, while a blank remark means the pincode is serviceable.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

filter_codes
Integer
	
False
	
Pincodes for which the serviceability needs to be checked, pass one pincode at a time.
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	86.02ms

P99 Latency (PRODUCTION)
	98.22ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	4500
Request
curl --request GET \
	--url 'https://staging-express.delhivery.com/c/api/pin-codes/json/?filter_codes=194103' \
	--header 'Authorization: Token xxxxxxxxxxxxxxxx'
Test Environment URL
https://staging-express.delhivery.com/c/api/pin-codes/json/?filter_codes=pin_code
Production Environment URL
https://track.delhivery.com/c/api/pin-codes/json/?filter_codes=pin_code
Heavy Product Type Pincode Serviceability API
This API provides the serviceability of the pincode for heavy shipments.
The Heavy pincode serviceability API is used to validate whether the pincodes are serviceable for the clients having product type Heavy, in Delhivery’s network.
“NSZ” response for a PIN code would mean that the PIN code is not serviceable.
The payment_type in the response indicates whether the Pincode is serviceable or not for that Payment mode.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

pincode
Integer
	
True
	
Pincode for which the serviceability needs to be checked, pass one pincode at a time

product_type
Varchar
	
True
	
Product_type stands for the Product Type of the account,pass Heavy
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	75.89ms

P99 Latency (PRODUCTION)
	77.77ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	3000
Request
curl --request GET \
	--url 'https://track.delhivery.com/api/dc/fetch/serviceability/pincode?product_type=Heavy&pincode=400086' \
	--header 'Accept: application/json' \
	--header 'Authorization: Token ****************'
Test Environment URL
https://staging-express.delhivery.com/api/dc/fetch/serviceability/pincode?
Production Environment URL
https://track.delhivery.com/api/dc/fetch/serviceability/pincode?


---

## expected-tat-api

<https://one.delhivery.com/developer-portal/document/b2c/detail/expected-tat-api>

Expected TAT API

Expected TAT API
This API provides the estimated TAT between the origin and destination pin code.
This API lets you query for TAT by providing the origin and destination PIN before an order is placed. This will provide the number of days in response.
The TAT begins from the moment the shipment is handed over to Delhivery.
The TAT provided is determined by the current network performance and may vary based on persistent delays in certain lanes. Similarly, our current network TAT may be faster than our promised TAT to you at the time of onboarding.
Different lanes may have unique cutoffs, which can affect expected delivery times.
If the expected delivery date falls on a holiday or Sunday, it will be adjusted to the next non-holiday.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

origin_pin
String
	
True
	
The pin code of the shipment's origin location.

destination_pin
String
	
True
	
The pin code of the shipment's destination location.

mot
String
	
True
	
Mode of Transport: 'S' for Surface, 'E' for Express, 'N' for NDD (Next Day Delivery).

pdt
String
	
False
	
Product Type: 'B2B', 'B2C', or empty (defaults to B2C if not provided).

expected_pickup_date
String
	
False
	
Datetime when pickup will be done. Based on this date, the response will show an expected delivery date considering the TAT and holidays in between.

Format for this payload is "YYYY-MM-DD HH:mm"
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	158.41ms

P99 Latency (PRODUCTION)
	366.49ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	750
Request
curl --request GET \
	--url 'https://express-dev-test.delhivery.com/api/dc/expected_tat?origin_pin=122003&destination_pin=136118&mot=S&pdt=B2C&expected_pickup_date=2024-05-31' \
	--header 'Accept: application/json' \
	--header 'Authorization: Token ********' \
	--header 'Content-Type: application/json'
Test Environment URL
https://staging-express.delhivery.com/api/dc/expected_tat?origin_pin=122003&destination_pin=136118&mot=S
Production Environment URL
https://track.delhivery.com/api/dc/expected_tat?origin_pin=122003&destination_pin=136118&mot=S


---

## fetch-waybill

<https://one.delhivery.com/developer-portal/document/b2c/detail/fetch-waybill>

Fetch WayBill

Fetch WayBill
This API is used to generate the bulk waybill list in advance, which can be stored and used in the order creation API.
The Bulk Waybill API generates waybills in bulk, which can be used during shipment manifestation or creation.
Up to 10,000 waybills in a single request can be fetched using this API and can be stored in the database for later use in the shipment manifestation.
A maximum of 50,000 waybills can be fetched within a 5-minute window. Exceeding this limit will result in your IP being throttled for 1 minute.

Note: Waybills are generated in batches of 25 at the backend. Using them immediately after fetching may occasionally result in errors, so we recommend storing them on your end and using them later during manifest creation.

Parameters
PARAMETERS	MANDATORY	DESCRIPTION

count
Integer
	
True
	
Number of waybills you want to fetch; Should not be more than 10,000
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	129.84ms

P99 Latency (PRODUCTION)
	154.02ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	5
Request
curl --request GET \
	--url 'https://staging-express.delhivery.com/waybill/api/bulk/json/?token=xxxxxxxxxxxxxxxx&count=5' \
	--header 'Accept: application/json'
Test Environment URL
https://staging-express.delhivery.com/waybill/api/bulk/json/?count=count
Production Environment URL
https://track.delhivery.com/waybill/api/bulk/json/?count=count
Fetch Single WayBill API
Fetch waybill API helps to fetch a single waybill at a time, every time the API is hit.
The Fetch Waybill API generates a single waybill at a time
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

token
String
	
True
	
Pass the account token
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	69.84ms

P99 Latency (PRODUCTION)
	94.02ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	750
Request
curl --request GET \
	--url 'https://staging-express.delhivery.com/waybill/api/fetch/json/?token=xxxxxxxxxxxxxxxx' \
	--header 'Accept: application/json'
Test Environment URL
https://staging-express.delhivery.com/waybill/api/fetch/json/
Production Environment URL
https://track.delhivery.com/waybill/api/fetch/json/


---

## order-creation

<https://one.delhivery.com/developer-portal/document/b2c/detail/order-creation>

Shipment Creation

Shipment Creation
This API is used to generate a B2C shipment in the Delhivery system.
The order creation process is the same for both forward flow (from client warehouse to end customer) and reverse flow (from customer to client warehouse), differing only in the payment_mode key:
Pickup for reverse packages
COD or Prepaid for forward packages
REPL for replacement Shipments
Single Piece Shipment: One waybill represents a package that can contain multiple items (e.g., an order with t-shirts, shoes, and shampoo packed together).
Multi Piece Shipment: Contains multiple boxes within one order. Each box should have its own waybill number.
The Order ID must be unique for each new order
The raw JSON body does not accept special characters: “&”, “#”, “%”, “;”, “\”. Use URL-encoded payloads instead.
Try to include all fields mentioned in the sample payload, even if they are not mandatory. These fields are considered good to have for optimal processing

Key Changes in Order Creation for RVP:

Set the payment mode as "Pickup" in the manifest payload.
When "Pickup" is used as the payment mode, the customer information will be treated as the pickup location. The return_add and other return-related fields will be used to define the drop/delivery address.
If both a return address and a pickup location are provided for a pickup shipment, the system will prioritize the return address, and the shipment will be delivered there.

Key Changes in Order Creation for REPL:

Set the payment mode as "REPL" in the manifest payload.
A single waybill will be generated, and the entire exchange journey will be executed using this one waybill.
The pickup location will serve as the pickup address, customer address as exchange location and return address will be treated as the final delivery address for the REPL shipment after successful exchange.
If the return address is not provided, the pickup location will be used as the final delivery address for the exchange shipment.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

name
string
	
True
	
Name of the consignee

order
string
	
True
	
Order ID

phone
string
	
True
	
Consignee phone number

add
string
	
True
	
Address of the consignee

pin
integer
	
True
	
Pincode of the consignee

address_type
string
	
False
	
Address type (home/office)

ewbn
string
	
False
	
Ewaybill number (for packages ≥ 50k)

hsn_code
string
	
False
	
HSN Code for e-waybill; more than one HSN can be passed if the quantity is > 1.

shipping_mode
string
	
False
	
Shipping mode (Surface/Express)

seller_inv
string
	
False
	
Seller invoice

city
string
	
False
	
City of the consignee

weight
float
	
False
	
Weight of the shipment (gms)

return_name
string
	
False
	
Return name

return_address
string
	
False
	
Return address

return_city
string
	
False
	
Return city

return_phone
string
	
False
	
Return phone number

return_state
string
	
False
	
Return state

return_country
string
	
False
	
Return country

return_pin
integer
	
False
	
Return pincode

seller_name
string
	
False
	
Seller name

fragile_shipment
boolean
	
False
	
Indicates if the shipment contains fragile items (true/false)

shipment_height
float
	
False
	
Height of the shipment (cm)

shipment_width
float
	
False
	
Width of the shipment (cm)

shipment_length
float
	
False
	
Length of the shipment (cm)

cod_amount
float
	
False
	
Cash on Delivery (COD) amount

products_desc
string
	
False
	
Product Description

state
string
	
False
	
State of the consignee (e.g., Rajasthan)

dangerous_good
boolean
	
False
	
Dangerous goods flag (true/false)

waybill
string
	
False
	
SPS: Waybill can be passed in the payload or can be skipped as well. MPS: Waybill needs to be passed for each box explicitly in the API.

total_amount
float
	
False
	
Total amount

seller_add
string
	
False
	
Seller address

country
string
	
False
	
Country (mandatory for Bangladesh, 'BD' value)

plastic_packaging
boolean
	
False
	
Plastic packaging flag (true/false)

quantity
string
	
False
	
Quantity

pickup_location
string
	
True
	
Name should be exactly the same as the name of the WH registered. It is case/space sensitive.

transport_speed
string
	
False
	
By passing the transport_speed field in the manifest request, you can choose:
F – Next Day Delivery (NDD)
OR
D – Standard delivery (regular TAT)

payment_mode
string
	
True
	
The value should be: Pickup for reverse shipments , COD or Prepaid for forward shipments and REPL for replacement shipments
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	283.57ms

P99 Latency (PRODUCTION)
	1.59s

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	20000
Request
curl --request POST \
	--url https://staging-express.delhivery.com/api/cmu/create.json \
	--header 'Accept: application/json' \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json' \
	--data 'format=json&data={
  "shipments": [
    {
      "name": "Consignee name",
      "add": "Huda Market, Haryana",
      "pin": "110042",
      "city": "Gurugram",
      "state": "Haryana",
      "country": "India",
      "phone": "9999999999",
      "order": "Test Order 01",
      "payment_mode": "Prepaid",
      "return_pin": "",
      "return_city": "",
      "return_phone": "",
      "return_add": "",
      "return_state": "",
      "return_country": "",
      "products_desc": "",
      "hsn_code": "",
      "cod_amount": "",
      "order_date": null,
      "total_amount": "",
      "seller_add": "",
      "seller_name": "",
      "seller_inv": "",
      "quantity": "",
      "waybill": "",
      "shipment_width": "100",
      "shipment_height": "100",
      "weight": "",
      "shipping_mode": "Surface",
      "address_type": ""
    }
  ],
  "pickup_location": {
    "name": "warehouse_name"
  }
}'
Test Environment URL
https://staging-express.delhivery.com/api/cmu/create.json
Production Environment URL
https://track.delhivery.com/api/cmu/create.json
MPS Manifestation
MPS (Multi-Package Shipment) refers to a single order shipped in multiple boxes. Each box is assigned a unique waybill number, with one designated as the master waybill and the others as child waybills.
The manifest payload for MPS shipments is similar to non-MPS, with the addition of specific MPS-related keys mentioned below
Prefetched waybills are mandatory for MPS shipments and must be included in the manifest payload.
For an MPS order with N boxes, include details of all N boxes within the shipments array; the sample payload illustrates a 2-box MPS example.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

mps_amount
Integer
	
True
	
Sum of all package amounts for cod. It will be zero in case of prepaid

mps_children
Integer
	
True
	
It is sum of master and child package

master_id
Integer
	
True
	
This will master waybill and need to be passed with every box

shipment_type
string
	
True
	
Pass MPS for manifestation of an MPS shipment
FAQ
Request
curl --request POST \
	--url https://staging-express.delhivery.com/api/cmu/create.json \
	--header 'Accept: application/json' \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json' \
	--data '
{
  "pickup_location": {
    "name": "warehouse_name"
  },
  "shipments": [
    {
      "order": "123456",
      "weight": "100",
      "mps_amount": "0",
      "mps_children": "2",
      "pin": "122002",
      "products_desc": "Toys, ToyCar",
      "add": "Test Address",
      "shipment_type": "MPS",
      "state": "TAMIL NADU",
      "master_id": "xxxxxxxxxxxxx",
      "city": "CHENNAI",
      "waybill": "xxxxxxxxxxxxx",
      "phone": "9999888800",
      "payment_mode": "Prepaid",
      "name": "Test Name",
      "total_amount": "4250",
      "country": "India"
    },
    {
      "order": "orderiod",
      "weight": "100",
      "mps_amount": "0",
      "mps_children": "2",
      "pin": "600063",
      "products_desc": "product description",
      "add": "Consignee Address",
      "shipment_type": "MPS",
      "state": "TAMIL NADU",
      "master_id": "xxxxxxxxxxxxx",
      "city": "CHENNAI",
      "waybill": "xxxxxxxxxxxxx",
      "phone": "9999888800",
      "payment_mode": "Prepaid",
      "name": "Consignee Naame",
      "total_amount": "4250",
      "country": "India"
    }
  ]
}
'
Test Environment URL
https://staging-express.delhivery.com/api/cmu/create.json
Production Environment URL
https://track.delhivery.com/api/cmu/create.json


---

## order-updation

<https://one.delhivery.com/developer-portal/document/b2c/detail/order-updation>

Shipment Updation

Shipment Updation/Edit API
This API helps to edit the shipment details.
Shipment Edit is allowed only on limited package status only
For Forward Shipment (Payment mode: COD/Prepaid), the edit is allowed if the shipment is in the below mentioned statuses:
Manifested
In Transit
Pending
For RVP shipment (Payment mode: Pickup), the edit is allowed if the shipment is in the below mentioned status:
Scheduled
For REPL shipment (Payment mode: REPL), the edit is allowed if the shipment is in the below mentioned statuses:
Manifested
In Transit
Pending
Edit is not allowed on any Dispatched and Terminal status like Delivered, DTO, RTO, LOST and Closed
Only the parameters specified below can be edited through the Shipment Updation API against waybill
Note: To update the payment mode through the B2C Edit API, below are a few points to keep in mind:
COD to Prepaid conversion is allowed.
Prepaid to COD conversion is allowed, but the COD amount must be provided.
Prepaid to Prepaid and COD to COD conversions are not allowed.
Prepaid to Pickup and Pickup to Prepaid conversions are not allowed.
COD to Pickup and Pickup to COD conversions are not allowed.
Prepaid to REPL and REPL to Prepaid conversions are not allowed.
COD to REPL and REPL to COD conversions are not allowed.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

waybill
string
	
True
	
Waybill for which update is required

name
string
	
False
	
Name of the consignee

phone
list
	
False
	
Consignee phone number

pt
String
	
False
	
Payment mode that needs to be updated

add
string
	
False
	
Address of the consignee

products_desc
string
	
False
	
Product Description

gm
float
	
False
	
Weight of the shipment (gms)

shipment_height
float
	
False
	
Height of the shipment (cm)

shipment_width
float
	
False
	
Width of the shipment (cm)

shipment_length
float
	
False
	
Length of the shipment (cm)
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	153.43ms

P99 Latency (PRODUCTION)
	318ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	12200
Request
curl --request POST \
	--url https://staging-express.delhivery.com/api/p/edit \
	--header 'Accept: application/json' \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json' \
	--data '
{
  "waybill": "843xxxxxxxxx",
  "pt": "COD/Pre-paid",
  "cod": 100,
  "shipment_height": 40.2,
  "gm": 100.2
}
'
Test Environment URL
https://staging-express.delhivery.com/api/p/edit
Production Environment URL
https://track.delhivery.com/api/p/edit


---

## order-cancellation

<https://one.delhivery.com/developer-portal/document/b2c/detail/order-cancellation>

Shipment Cancellation

Shipment Cancellation
This API allows to cancel the shipment.
Shipment Cancellation is allowed only on a limited package status.
For Forward Shipment (Payment mode: COD/Prepaid), below are the allowed package statuses where cancellation is allowed:
Manifested
In Transit
Pending
For RVP shipment (Payment mode: Pickup), below are the allowed package statuses where cancellation is allowed:
Scheduled
For REPL shipment (Payment mode: REPL), below are the allowed package statuses where cancellation is allowed:
Manifested
In Transit
Pending
If a manifested shipment is canceled before pickup, its status remains Manifested with the status type UD (Undelivered).
If a shipment in In Transit or Pending state is canceled, the status stays In Transit and the status type changes to RT (Return to Origin).
If a scheduled shipment is canceled, its status updates to Canceled with the status type CN (Cancellation).
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

waybill
String
	
True
	
Waybill number of the shipment

cancellation
String
	
True
	
This key needs to be passed as true to cancel a shipment
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	153.43ms

P99 Latency (PRODUCTION)
	318ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	12200
Request
curl --request POST \
	--url https://staging-express.delhivery.com/api/p/edit \
	--header 'Accept: application/json' \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json' \
	--data '
{
  "waybill": "6945XXXXXXXX",
  "cancellation": "true"
}
'
Test Environment URL
https://staging-express.delhivery.com/api/p/edit
Production Environment URL
https://track.delhivery.com/api/p/edit


---

## ewaybill-update

<https://one.delhivery.com/developer-portal/document/b2c/detail/ewaybill-update>

Ewaybill Update API

Ewaybill Update API
This API allows to update the e-waybill of the shipment.
An E-Way Bill is an electronic document (having details such as the goods being transported, their value, the sender, the receiver, and the route.) that is required for the transportation of goods having shipment value>50k as per the Indian government laws.
Use the EWB update API to update the e-waybill of the shipments having value > 50k
This API updates the forward E-waybill when the shipment is in the forward flow, and updates the return E-waybill when the shipment is in the return flow.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

dcn
Varchar
	
True
	
Pass the invoice number

ewbn
Varchar
	
True
	
Pass the ewb (e-waybill) number that needs to be updated
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	327.6ms

P99 Latency (PRODUCTION)
	501.68ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	250
Request
curl --request PUT \
	--url https://staging-express.delhivery.com/api/rest/ewaybill/XXXXXXXXXXXXX/ \
	--header 'Authorization: Token xxxxxxxxxxxxxxxx' \
	--header 'content-type: application/json' \
	--data '
{
  "data": [
    {
      "dcn": "pass the invoice number",
      "ewbn": "pass the ewb number"
    }
  ]
}
'
Test Environment URL
https://staging-express.delhivery.com/api/rest/ewaybill/{waybill}/
Production Environment URL
https://track.delhivery.com/api/rest/ewaybill/{waybill}/


---

## order-tracking

<https://one.delhivery.com/developer-portal/document/b2c/detail/order-tracking>

Shipment Tracking

Shipment Tracking
The API provides the current status and detailed history of scans applied to the shipment.
The track API takes as input as either waybill number or order ID, and returns all the details of the scans applied on the shipment.
Track upto 50 waybills (comma-separated) with a single request
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

waybill
String
	
True
	
Waybill Number

ref_ids
String
	
False
	
Order_Id
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	130.31ms

P99 Latency (PRODUCTION)
	529.15ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	750
Request
curl --request GET \
	--url 'https://staging-express.delhivery.com/api/v1/packages/json/?waybill=1122345678722&ref_ids=' \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json'
Test Environment URL
https://staging-express.delhivery.com/api/v1/packages/json/?waybill=waybill_num&ref_ids=order_id
Production Environment URL
https://track.delhivery.com/api/v1/packages/json/?waybill=waybill_num&ref_ids=order_id


---

## calculate-shipping-cost

<https://one.delhivery.com/developer-portal/document/b2c/detail/calculate-shipping-cost>

Calculate Shipping Cost

Calculate Shipping Cost
This API is used to calculate the Estimated Shipping Charges for the Shipments.
This API provides approximate values for shipping charges, which are subject to change.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

md
string
	
True
	
Billing Mode of shipment ( E for Express/ S for Surface ).

cgm
Integer
	
True
	
Chargeable weight of the shipment (Only in Grams Unit); Default value is 0

o_pin
Integer
	
True
	
Pincode of origin city; 6 Digit Valid Pin code

d_pin
Integer
	
True
	
Pincode of destination city; 6 Digit Valid Pin code

ss
string
	
True
	
Status of shipment (Delivered, RTO, DTO)

pt
String
	
True
	
Payment Type ( Pre-paid, COD )

l
Integer
	
False
	
Length of shipment

b
Integer
	
False
	
Breadth of shipment

h
Integer
	
False
	
Height of shipment

ipkg_type
String
	
False
	
Type of Package (box/flyer)
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	450.94ms

P99 Latency (PRODUCTION)
	61.14s

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	50
Request
curl --request GET \
	--url 'https://staging-express.delhivery.com/api/kinko/v1/invoice/charges/.json?md=E&ss=Delivered&d_pin=110053&o_pin=110042&cgm=10&pt=Pre-paid' \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json'
Test Environment URL
https://staging-express.delhivery.com/api/kinko/v1/invoice/charges/.json?md=E&ss=Delivered&d_pin=110053&o_pin=110042&cgm=10&pt=Pre-paid
Production Environment URL
https://track.delhivery.com/api/kinko/v1/invoice/charges/.json?md=E&ss=Delivered&d_pin=110053&o_pin=110042&cgm=10&pt=Pre-paid


---

## generate-shipping-label

<https://one.delhivery.com/developer-portal/document/b2c/detail/generate-shipping-label>

Generate Shipping Label

Generate Shipping Label
This API is used to Generate Shipping labels against a waybill number. Shipping labels can also be downloaded from the One Panel.
A custom label can be created by setting the pdf parameter to false. The API will return a JSON response, which should be rendered into HTML using encoding 128. This allows for flexibility in designing the layout of the shipping label and adding any necessary information.
Additionally, you can use the parameter pdf_size to generate labels in different sizes.
For size 8x11 (A4), pass: pdf_size=A4
For size 4x6 (4R), pass: pdf_size=4R
If the pdf_size parameter is not provided, the label will default to A4 size.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

waybill
String
	
True
	
Waybill number of the shipment

pdf
Boolean
	
False
	
If passed True: An S3 link of the pdf will be generated which cannot be customized.If passed False: Response would be Json, that can manipulated as per the requirement.

pdf_size
String
	
False
	
For size 8x11 (A4), pass: pdf_size=A4 For size 4x6 (4R), pass: pdf_size=4R
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	210.64ms

P99 Latency (PRODUCTION)
	61.78s

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	3000
Request
curl --request GET \
	--url 'https://staging-express.delhivery.com/api/p/packing_slip?wbns=7035xxxxxxxxxxx&pdf=true&pdf_size=4R' \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json'
Test Environment URL
https://staging-express.delhivery.com/api/p/packing_slip?wbns=waybill&pdf=true&pdf_size=
Production Environment URL
https://track.delhivery.com/api/p/packing_slip?wbns=waybill&pdf=true&pdf_size=


---

## pickup-scheduling

<https://one.delhivery.com/developer-portal/document/b2c/detail/pickup-scheduling>

Pickup Request Creation

Pickup Request Creation
The Pickup Request Creation API is used to initiate a pickup request once an order has been manifested and is ready for collection.
The pickup request is raised against the warehouse location, not the waybill number. Therefore, you do not need to create multiple pickup requests for multiple waybills if they are all being picked up from a single location. If shipments are at two different locations, you need to raise separate pickup requests for each location.
For any given day, a second pickup request can be raised for any warehouse only when the existing pickup request is closed.
The shipping label on the shipment should include essential information such as the recipient's address, a scannable tracking number barcode, and any other relevant shipping details.
The right time to create a pickup request is when the shipment is packed and ready to be handed over to the FE.
Integrating this API is optional since pickup requests can also be created from the One Panel. Additionally, you can enable auto-pickup for your account with assistance from your account POC.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

pickup_time
String
	
True
	
Time for the pickup(hh:mm:ss)

pickup_date
String
	
True
	
Date for the pickup(YYYY-MM-DD)

pickup_location
String
	
True
	
Registered client warehouse from where the shipment is to be picked. Also referred to as pickup location.

expected_package_count
Integer
	
True
	
Count of packages that need to be picked up.
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	242.37ms

P99 Latency (PRODUCTION)
	885.95ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	4000
Request
curl --request POST \
	--url https://staging-express.delhivery.com/fm/request/new/ \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json' \
	--data '
{
  "pickup_time": "11:00:00",
  "pickup_date": "2023-12-29",
  "pickup_location": "warehouse_name",
  "expected_package_count": 1
}
'
Test Environment URL
https://staging-express.delhivery.com/fm/request/new/
Production Environment URL
https://track.delhivery.com/fm/request/new/


---

## warehouse-creation

<https://one.delhivery.com/developer-portal/document/b2c/detail/warehouse-creation>

Client Warehouse Creation

Client Warehouse Creation
This API is used to register the pickup location in the Delhivery system, which is further used to create the order.
The client’s pickup locations or warehouses, where shipments will be physically picked up, must be registered in the Delhivery system beforehand.
Warehouse name is case-sensivite so whatever name you register with this API, make sure exact same warehouse name is used while creating order
A return address also need to be configured for each warehouse, which can either be the warehouse itself or some other address.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

name
String
	
True
	
Name the warehouse, It will be considered as your pickup location.

registered_name
String
	
False
	
Pass your registered account name

phone
string
	
True
	
Contact number of the POC of the warehouse.

email
string
	
False
	
Email address of the POC of the warehouse.

address
string
	
False
	
Complete address of the warehouse.

city
string
	
False
	
City in which warehouse is located.

pin
String
	
True
	
Pincode of the area where the warehouse is located.

country
String
	
False
	
Country where the warehouse is located.

return_address
String
	
True
	
Complete return address of the warehouse. It can be the same as the pickup address as wel

return_city
String
	
False
	
City where the shipment will be returned

return_pin
String
	
False
	
Pincode of the city where the shipment will be returned.

return_state
String
	
False
	
State where the shipment will be returned.

return_country
String
	
False
	
Country where the shipment will returned.
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	172.45ms

P99 Latency (PRODUCTION)
	396.51ms

Rate Limit (Requests/Minute/IP) (PRODUCTION)
	10
FAQ
Request
curl --request POST \
	--url https://staging-express.delhivery.com/api/backend/clientwarehouse/create/ \
	--header 'Accept: application/json' \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json' \
	--data '
{
  "phone": "9999999999",
  "city": "Kota",
  "name": "test_name",
  "pin": "110042",
  "address": "address",
  "country": "India",
  "email": "abc@gmail.com",
  "registered_name": "registered_account_name",
  "return_address": "return_address",
  "return_pin": "110042",
  "return_city": "Kota",
  "return_state": "Delhi",
  "return_country": "India"
}
'
Test Environment URL
https://staging-express.delhivery.com/api/backend/clientwarehouse/create/
Production Environment URL
https://track.delhivery.com/api/backend/clientwarehouse/create/


---

## warehouse-updation

<https://one.delhivery.com/developer-portal/document/b2c/detail/warehouse-updation>

Client Warehouse Updation

Client Warehouse Updation
This API is used to edit/update an existing Warehouse
Warehouse name cannot be updated.
You must provide the warehouse name along with the fields you wish to update.
Only the parameters listed below can be updated for the given warehouse name.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

name
String
	
True
	
Warehouse name in our system for which the details need to be updated.

address
String
	
False
	
address that needs to be updated

pin
String
	
True
	
pincode for the warehouse that needs to be updated

phone
String
	
False
	
Phone number that needs to be updated
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	345.65ms

P99 Latency (PRODUCTION)
	61.16s

Rate Limit (Requests/Minute/IP) (PRODUCTION)
	10
Request
curl --request POST \
	--url https://staging-express.delhivery.com/api/backend/clientwarehouse/edit/ \
	--header 'Accept: application/json' \
	--header 'Authorization: Token XXXXXXXXXXXXXXXXX' \
	--header 'Content-Type: application/json' \
	--data '
{
  "name": "registered_wh_name",
  "phone": "9988******",
  "address": "HUDA Market, Gurugram, Haryana - 122001"
}
'
Test Environment URL
https://staging-express.delhivery.com/api/backend/clientwarehouse/edit/
Production Environment URL
https://track.delhivery.com/api/backend/clientwarehouse/edit/


---

## webhook_functionality

<https://one.delhivery.com/developer-portal/document/b2c/detail/webhook_functionality>

WEBHOOK

Webhook Functionality
Webhook provides Shipment Status Push and Document(POD, Sorter Image, QC Image) Push
Webhook for Shipment Status Push and POD Push

Delhivery B2C integration offers webhooks for real-time order updates and document sharing. These updates follow a standard JSON payload format. Once the webhook is configured, clients will begin receiving updates in real time. In case you don't want to use Polling API for order updates and tracking, this is an alternative.

Prerequisites to enable a webhook
Complete the Delhivery Webhook Requirement Document by providing your Delhivery account name, endpoint URL, and authorization details. Share the filled document via email to “lastmile-integration@delhivery.com” keeping your business account POC in loop.
Please note that Scan Push and Document Push are two separate webhooks and cannot be combined into a single webhook endpoint.
Refer to the sample Webhook Requirement Documents attached below. Fill out the relevant document(s) based on your webhook requirement and share them as instructed.

Scan Push Webhook Requirement Document

POD Webhook Requirement Document

Sorter Image Webhook Requirement Document

QC Image Webhook Requirement Document

Key Points for Shipment Status Webhook:
Apart from the AWB Track API, if the client wants to receive real-time shipment status updates, statuses can be pushed at the AWB level.
All statuses applied to an AWB will be pushed in real-time through the webhook.
Delhivery’s tech team will test the status push and release it to production after successful testing.
Delhivery can send additional data related to tracking in the scan push or map a custom payload based on the client’s system requirements.
Delhivery has a capability to send additional data in scan push or map a custom payload also as per client system requirements.

Statuses pushed for shipment through the webhook:
For a forward shipment (picking up the shipment from the warehouse and delivering it to the end consignee), the following statuses and status types are pushed through the webhook:

Here is the list of status and status types being pushed through the webhook:

STATUS TYPE	STATUS	DESCRIPTION
UD	Manifested	Order created in the Delhivery system
UD	Not Picked	When Shipment is not physically Picked up from the Clients Warehouse
UD	In Transit	Shipment is In Transit and moving to the Destination city
UD	Pending	When a forward shipment has reached the destination City but has not yet been dispatched for delivery
UD	Dispatched	When a forward shipment is dispatched for delivery to the end customer
DL	Delivered	When the shipment is delivered to the end customer
For a Return shipment (when the Shipment isnt delivered and is returned),

Here is the list of status and status types being pushed through the webhook:

STATUS TYPE	STATUS	DESCRIPTION
RT	In Transit	When forward shipment is converted in to Return shipment after unsucessfull delivery/clients Instruction/adhoc requests or conditions system
RT	Pending	When a shipment has reached DC nearest to Origin center.
RT	Dispatched	When a shipment has reached DC nearest to Origin center and dispatched for delivery
DL	RTO	When a forward shipment is returned to Origin
For a Reverse shipment (when picking up shipments from customer location and delivering it to client warehouse.),

the following statuses and status types are pushed through the webhook:

STATUS TYPE	STATUS	DESCRIPTION
PP	Open	When pick up request is created in our system
PP	Scheduled	When a pickup request is scheduled, it automatically moves from "open" to "scheduled" status in our system. We keep these statuses separate to improve visibility as we integrate with Parcelled.
PP	Dispatched	When FE is out in the field to collect this package from the end customer.
PU	In Transit	When pick up shipment is in transit to RPC from DC after physical pick up.
PU	Pending	When pickup shipment has reached RPC but not yet dispatched for delivery to the client.
PU	Dispatched	When pickup shipment is dispatched for delivery to the client from RPC.
DL	DTO	When pickup shipment is accepted by the client and POD is received.
CN	Canceled	When a reverse pickup shipment is canceled before getting picked up from customer
CN	Closed	When a reverse pickup shipment is canceled and request is closed


---

## rvp_qc

<https://one.delhivery.com/developer-portal/document/b2c/detail/rvp_qc>

RVP QC

RVP QC 3.0
This is used to perform Quality Check (QC) at the consignee's doorstep for an RVP (Reverse Pickup) shipment.
This is an updated version of the RVP QC that gives the flexibility of a question-based model. It will allow a set of questions against each item to be picked on the ground by FE from the end customer. Pickup will only be made once all the mandatory questions have been answered correctly.
Steps of Integration:
QC question mapping
Order Creation

1. QC Question Mapping

A one-time QC mapping is required on Delhivery’s end to enable this feature. Based on the client’s QC requirements, the Delhivery BD team will share the relevant Delhivery QC questions along with their corresponding question IDs. The client must then map these Delhivery question IDs to their own question IDs and share the mapping in the specified format, so it can be configured in the Delhivery system.

CLIENT QUESTION ID	DLV QUESTION ID
Client Question id-1	DLV Question id-1
Client Question id-2	DLV Question id-2
Client Question id-3	DLV Question id-3
Client Question id-4	DLV Question id-4
Client Question id-5	DLV Question id-5
2. Order Creation

When creating an RVP order via API, 2 keys must be included in the manifest payload:

"qc_type": Set this key to the hardcoded value “param” to indicate Parametric QC.
“custom_qc”: Include the QC data in the manifest payload within this array. Refer the sample payload in the request section

NOTE: A maximum of 2 items can undergo QC, with a limit of 6 questions per item. If these limits are exceeded, the shipment will still be created, but it will be marked as a non-QC shipment.

Parameters
PARAMETERS	MANDATORY	DESCRIPTION

item
string
	
False
	

description
string
	
True
	

images
list
	
True
	
Comma-separated multiple strings can be passed

return_reason
string
	
False
	

quantity
integer
	
True
	
Default value is 1, if quantity is not presents

brand
string
	
False
	

product_category
string
	
False
	

questions
list
	
True
	

questions_id
string
	
True
	
This will be the client question id and against this ID Delhivery will map one question at their end

options
list
	
True
	

value
list
	
True
	
Currently only the first element is chosen as the correct option

required
boolean
	
True
	
False: Question will still be asked but the answer will not affect the QC result, i.e. If FE chooses any available answer to the given QC question, QC will always be Passed.True: Question will be asked and the answer will affect QC result, i.e. If FE chooses the incorrect answer to the given QC question, QC will be Failed

type
String
	
True
	
Type == ‘varchar’; FE will type the answer Type == ‘multi’; FE will select one of the given options

ques_images
list
	
False
	
this is a non-mandatory field and completely optional for a client to pass. The client has to pass the image URL, which will be visible to the FE for a specific question for which QC is performed
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	366.03 ms

P99 Latency (PRODUCTION)
	916.17ms

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	20000
Request
curl --request POST \
	--url https://staging-express.delhivery.com/api/cmu/create.json \
	--header 'Authorization: Token xxxxxxxxxxxxxxxxxxxxx' \
	--header 'Content-Type: application/json' \
	--data 'format=json&data={
  "shipments": [
    {
      "client": "pass the registered client name",
      "return_name": "test_designs",
      "order": "1234567890",
      "return_country": "India",
      "weight": "150.0 gm",
      "city": "Meerjapuram",
      "pin": "521111",
      "return_state": "Gujarat",
      "products_desc": "NEW EI PIKOK (PURPAL-ORANGE)",
      "shipping_mode": "Express",
      "state": "Andhra Pradesh",
      "quantity": 1,
      "waybill": "123455678910",
      "phone": "1234567890",
      "add": "7 106 abc road, 2020 bulding ",
      "payment_mode": "Pickup",
      "order_date": "29-06-2023",
      "seller_gst_tin": "ABCD1234F",
      "name": "Jitendra Singh",
      "return_add": " SHOP NO 218,ABC Road, Mumbai",
      "total_amount": 749,
      "seller_name": "ABC Design",
      "return_city": "SURAT",
      "country": "India",
      "return_pin": "394101",
      "return_phone": "1234567890",
      "qc_type": "param",
      "custom_qc": [
        {
          "item": "mobile",
          "description": "Mi note 1 pro",
          "images": [
            "https://fdn2.gsmarena.com/vv/pics/xiaomi/xiaomi-note-pro-2.jpg"
          ],
          "return_reason": "Damaged",
          "quantity": 1,
          "brand": "Mi",
          "product_category": "mobile",
          "questions": [
            {
              "questions_id": "client Question id",
              "options": [
                ""
              ],
              "value": [
                "123456543"
              ],
              "required": true,
              "type": "varchar",
              "ques_images": [
                "http://ecx.images-amazon.com/images/I/414yumheSAS._AC_.jpg"
              ]
            }
          ]
        },
        {
          "item": "mobile",
          "description": "Mi note 2 pro",
          "images": [
            "https://static.toiimg.com/photo/55073523/Xiaomi-Mi-Note-2.jpg"
          ],
          "return_reason": "Damaged",
          "quantity": 2,
          "brand": "Mi",
          "product_category": "apparel",
          "questions": [
            {
              "questions_id": "client question id",
              "options": [
                "Black",
                "other"
              ],
              "value": [
                "Black"
              ],
              "required": true,
              "type": "multi",
              "ques_images": [
                "http://ecx.images-amazon.com/images/I/414yumheSAS._AC_.jpg"
              ]
            }
          ]
        }
      ]
    }
  ],
  "pickup_location": {
    "name": "pass the registered pickup WH name"
  }
}'
Test Environment URL
https://staging-express.delhivery.com/api/cmu/create.json
Production Environment URL
https://track.delhivery.com/api/cmu/create.json


---

## download

<https://one.delhivery.com/developer-portal/document/b2c/detail/document/download>

Download Document

Download Document API
This API allows fetching documents associated with B2C orders.
Document download API enables retrieving multiple types of documents that are not archived in the Delhivery system.
Allowed Document Types:
SIGNATURE_URL
RVP_QC_IMAGE
EPOD
SELLER_RETURN_IMAGE
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

doc_type
Varchar
	
True
	
The type of document to fetch (e.g., SIGNATURE_URL, EPOD)

waybill
integer
	
True
	
Delhivery waybill number
Request
curl --request GET \
	--url 'https://staging-express.delhivery.com/api/rest/fetch/pkg/document/?doc_type=doc_type&waybill=1234567890' \
	--header 'Authorization: Token ********************' \
	--header 'Cookie: sessionid=14901340921'
Test Environment URL
https://staging-express.delhivery.com/api/rest/fetch/pkg/document/?doc_type={doc_type}&waybill={AWB}
Production Environment URL
https://track.delhivery.com/api/rest/fetch/pkg/document/?doc_type={doc_type}&waybill={AWB}


---

## ndr-api

<https://one.delhivery.com/developer-portal/document/b2c/detail/ndr-api>

NDR API

NDR API
This API allows to take the action on the NDR shipments.
NDR API is an asynchronous API, which provides the UPL ID in the Response
The UPL ID is further used in the GET NDR Status API to get the status of the UPL ID for which the NDR action was taken
Currently 2 actions are allowed in the NDR API:
RE-ATTEMPT
PICKUP_RESCHEDULE

Key considerations for using the NDR API:

1. For RE-ATTEMPT:

RE-ATTEMPT" action can be applied to an AWB if its current NSL code is in the following list: ["EOD-74", "EOD-15", "EOD-104", "EOD-43", "EOD-86", "EOD-11", "EOD-69", "EOD-6"]
It is recommended to apply "RE-ATTEMPT" late in the evening (after 9 PM) to ensure all NDR AWBs are back in the facility and all dispatches are closed.
Always verify the current NSL of the AWB while applying NDR.
The attempt count for the shipment should be either 1 or 2.

2. FOR PICKUP_RESCHEDULE :

This action can be applied to an AWB if it fulfills below conditions:

If the AWB current NSL code is in the below list ["EOD-777", "EOD-21"] , The shipment status is marked as Cancelled.

Note: Shipment should be Non OTP Cancelled.

Apply ‘PICKUP_RESCHEDULE’ after 9 PM to ensure that all open dispatches in the facility are closed by that time.
The attempt count for the shipment should be either 1 or 2.
Parameters
PARAMETERS	MANDATORY	DESCRIPTION

waybill
string
	
True
	
Waybill for which NDR needs to be applied

act
string
	
True
	
Action needs to be passed here, RE-ATTEMPT PICKUP_RESCHEDULE
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	93.77ms

P99 Latency (PRODUCTION)
	126.38s

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	NA
Request
curl --request POST \
	--url https://express-dev-test.delhivery.com/api/p/update \
	--header 'Accept: application/json' \
	--header 'Authorization: Token ******************************' \
	--header 'Content-Type: application/json' \
	--data '
{
  "data": [
    {
      "waybill": "13163116xxxxxx",
      "act": "RE-ATTEMPT"
    }
  ]
}
'
Test Environment URL
https://staging-express.delhivery.com/api/p/update
Production Environment URL
https://track.delhivery.com/api/p/update
GET NDR STATUS API
This API is used to get the status of the request_id(i.e UPL ID) received from the NDR API
Rate Limit and Latency
METRICS	VALUE

Average Latency (PRODUCTION)
	75.03ms

P99 Latency (PRODUCTION)
	88.03s

Rate Limit (Requests/5 Minute/IP) (PRODUCTION)
	NA
Request
curl --request GET \
	--url 'https://track.delhivery.com/api/cmu/get_bulk_upl/UPL70200521839149515?verbose=true' \
	--header 'Accept: application/json' \
	--header 'Authorization: Token **************************' \
	--header 'Content-Type: application/json'


---

## faq

<https://one.delhivery.com/developer-portal/document/b2c/detail/faq>

Frequently Asked Questions (FAQ)

Frequently Asked Questions (FAQ)
CREATE & UPDATE SHIPMENT API:
Q1.How to Execute Delhivery API ?
To Execute the API, you need to login to the Delhivery UCP panel with your Delhivery registered email id.
URL:  https://one.delhivery.com/
After login, go to the CDP (Client Developer portal) by following steps to execute the API:
Settings> API Setup> Test our APIs
1. On the UCP home page sidebar, click on the "Settings"
2. Then, click on the "API Setup"
To view the API documentation only then click on the "See our documentation" link.
To test the API click on the "Test our APIs" button.
Q2.What is an API Token and How to get that?
An API Token is a static authentication key used to verify the identity of a client. This token is unique for each client registered with us. Additionally, if a client has multiple accounts, each account will have a distinct token key.
For testing purposes, the API Token will be provided by Delhivery Business account POC who manages client accounts within the Business Team. For production accounts, the token can be obtained from the Delhivery One panel.
Q3.I am getting the error "format key missing in the post" in the Package Order Creation API response.
The format=json&data= (without quotes) parameter is mandatory in the request payload for order creation in our system. Please refer to the screenshot for further details.
Q4.How do I get the PHP cURL code for the API?
Our API uses JSON format for both requests and responses, so you may need to convert it according to your requirements. When you test the API using Postman, you can obtain code snippets in various programming languages by clicking the "Code" button in the upper right section of the Postman interface.

Please refer to the screenshot for further details.
Q5.What is the "QC" field in the Order Creation API, and why is it required?
“QC” means Quality check and QC Is being done for the Reverse Pickup (RVP) orders, if the client wants Delhivery to verify the product at the time of pickup from the customer. For prepaid or COD orders, the "QC" field is not required. Additionally, "QC" is an optional field in our Manifestation API and can be used only if you have alignment with the Business team regarding QC requirements.
Q6.How do I get a waybill in the Package Order Creation API?
There are two methods for waybill creation:
When calling the API, leave the "waybill" field blank. The API will return a dynamically generated waybill in the response.
Alternatively, you can fetch waybills in advance and store them in your system. Then, when calling the API, you can provide these waybills one by one. Use the "Single Waybill Fetch API" to obtain a single waybill, and the "Bulk Waybill Fetch API" to retrieve multiple waybills.
Q7.Will the API endpoint and token remain the same for package creation API for the live environment?
No, for the live environment, you just need to replace "staging-express" with "track" for all API's endpoints and the live token will be different from the Test environment, which will be again shared by BD-Business Development SPOC assigned to your account.
Common Remarks :
Error Remarks	Reason	Solution
Getting an error “Authentication credentials were not provided” while trying to manifest the Shipment.	This error comes when we do not pass the Authorization Token in the API Header.	Need to pass correct Authorization Token under API Header.
Getting the error "shipment list contains no data".	This error comes when we do not pass the correct client name under the “client” payload in the API.	You will have to pass the exact client name registered with us (Please note that client name is case sensitive).
Getting an Error message “ Unterminated string starting at: line … column … (char …).	This error means that the Special character you are using in the mentioned API line ….. is not allowed in our API.	Please do not pass the below-mentioned special characters in the API & % # ; \
Getting error "format key missing in the post" in Package Order Creation API response.	That means you are missing JSON format static value on top of the API body.	"format=json&data=" (without quotes) is mandatory to pass in the request payload in order creation in our system.
Getting the error in response "Unable to consume waybill XXXX"?	This issue only occurs if there is a mismatch in the allocated waybill series or the waybill is already consumed.	Please validate the Waybill before passing in the waybill and fetch the waybill in advance before passing that in API, You can fetch the waybill using our fetch waybill API.
Getting the error "rmk": "ClientWarehouse matching query does not exist." while trying to execute the Manifestation API.	This error comes when we do not pass the correct warehouse name in the "name" field of the "pickup_location" dictionary.	Please pass the correct warehouse/Pickup_location name under "pickup_location", "name" OR use warehouse creation API to create a new warehouse for your account.
Getting the error "rmk": "Client-Warehouse is not active."	This means the warehouse name that you are using under the “pickup_location”, “name” field is currently Inactive at our end.	Please connect with your delhivery account POC (Spokesperson) to get this activated or for further discussion on it.
Getting the error “Crashing while saving package due to exception suspicious order/consignee”.	The shipment manifestation has failed because the consignee is Suspicious.	Please connect with your delhivery business account POC to discuss this further.
Getting the error “Crashing while saving package due to exception PUR (shipment pickup from seller) failure rate of the seller is very high.”	The error comes because the PUR failure rate of the seller is very high.	Please connect with your delhivery account POC to discuss this further.
Getting the error "Duplicate Order Id" while trying to manifest the shipment.	This error comes when we pass the same Order id which is already created for the same account.	If the below 6 fields are the same for 2 orders then the 2nd order will fail while doing the manifest with the error of duplicate order id.

client name
order id
total amount
product description
payment mode
consignee name

Getting the error "Crashing while saving package due to exception 'client manifest charge API failed due to insufficient balance'. Package might have been partially saved."	This error while Manifesting the Shipment OR generating the Pickup Request.	So to fix the issue you will have to recharge your wallet with a minimum of 500 to Manifest the shipment and raise the Pickup request.
Getting the error " Error message is 'unicode' object has no attribute 'get'.	This error comes when you do not pass shipment as a list.	Please pass shipment as a list, In the Manifestation API's Payload.
Getting the error "Crashing while saving package due to exception 'Package type Pickup/COD/REPL/Prepaid not serviceable for this account "Package might have been partially saved."	This error comes when the service “payment_mode” you are using in API is not enabled for your account.	Please connect with your delhivery POC to get the required service enabled for your account.
Getting the error "Crashing while saving package due to exception '1100** is non serviceable pincode'. Package might have been partially saved."	This error comes when we use Non-serviceable Pincode in Manifestation API.	Please use a serviceable PIN code and try to manifest the shipment. You can use Pincode serviceability API to check the serviceability of Pincodes.
Getting the error "Incorrect phone number(s) for order *****” while trying to manifest the shipment.	The Phone number you have passed under the "phone" payload in API has some Ambiguity.	Please pass the correct phone number according to the format mentioned below:
Phone numbers passed for order during manifestation undergo the below checks:
The number can have the below prefixes:
91
+91
+91-
91-
0

Getting the error "Duplicate waybill" while trying to manifest the shipment	This error comes when we use same waybill in the Manifestation API which has been already manifested earlier.	Use a differenet waybill number.
Getting the error "oid does not pass the validator <lambda>.check if there any extra character or dots in column" while trying to manifest the shipment	This error comes when we use the Order id value as more than 50 character. The max character allowed in the "order" field is 50.	Use less than 50 character and test again.
Getting error "Crashing while saving package due to exception Manifestation failed as the pickup capacity has exceeded the available capacity of this pincode. Package might have been partially saved."	You have exceeded the daily shipment manifestation capacity for this pincode.	You may try again after midnight. Alternatively, for urgent shipment manifestation, please get in touch with your Delhivery account point of contact (POC).
Getting the error "Crashing while saving package due to exception Shipment restricted based on historical delivery outcomes. Package might have been partially saved."	This error occurs when the consignee has a high return history in the past, due to which the consignee’s number has been blocked at our end.	Please connect with your delhivery account POC to discuss this further.
Crashing while saving package due to exception suspicious order/consignee. Package might have been partially saved	This error comes when the consignee is blocked in the Delhivery system due to previously identified fraudulent activity. As a result, the associated UCID is blocked in DLV system	Please connect with your delhivery account POC to discuss this further.
Q8.How to resolve the error "rmk": "client is not active"?
This error typically occurs when the client account is inactive or the end date associated with the account has expired. To resolve this, please contact your business account point of contact (POC) and request them to verify if the account is active and the end date is valid. If needed, they can make the necessary changes to reactivate the account. Once updated, you can retry the API call—it should work as expected.
Q9."rmk": "Package creation API error.Package might be saved.Please contact tech.admin@delhivery.com. Error message is 'NoneType' object has no attribute 'end_date' . Quote this error message while reporting."
This issue usually occurs due to an environment mismatch. If you're using a production token with a staging API (or vice versa), the request will fail. Please ensure that you are using the correct token corresponding to the environment:

-->Use the staging token with the staging API
-->Use the production token with the production API
Matching the token and API environment correctly should resolve the issue.
Q10.When should I use Multi-Package Shipment (MPS) for order creation?
You should use the Multi-Package Shipment (MPS) API when the products in an order are packed in separate containers or boxes. This allows each package to be tracked individually under the same order.

If all products are packed in a single container, you can proceed with the standard (single-package) shipment creation API. In that case, product details can be passed as a comma-separated string in the products_desc field.

Please share your packaging approach so we can guide you accordingly.
Q11.Pincode is serviceable but still getting error "Crashing while saving package due to exception '1100** is non serviceable pincode'. Package might have been partially saved."?
This error typically occurs when the pincode is serviceable for B2C shipments, but you're trying to manifest a heavy shipment. To troubleshoot this issue:

-->Check if the pincode is serviceable for heavy shipments using the Heavy Pincode Serviceability API.
-->Verify if your account is configured for heavy shipments. Some accounts are restricted to B2C services only.
-->Review your payload to ensure you're not unintentionally passing product_type as heavy.
If none of these conditions apply and the issue persists, please reach out to the Last-Mile Integration team for further support.
CHECK PINCODE SERVICEABILITY API:
Q1.What is the Pin-code Serviceability API?
The Pin-code Serviceability API provides a list of all pin codes serviced by Delhivery, along with flags indicating whether each pincode is serviceable for both prepaid and COD packages. Additionally, an “NSZ” response for an AWB means that the pincode is not serviceable.
Q2.How can I identify from the pincode response whether a pincode is serviceable or not?
To determine if a pincode is serviceable or not, refer to the initial section of the response provided below.
"delivery_codes": [

{

"postal_code": {
"city": "Mumbai",
"cod": "N",
"inc": "Mumbai MIDC (Maharashtra)",
"district": "Mumbai",
"pin": 400064,
"max_amount": 0.0,
"pre_paid": "Y",
"cash": "Y",
"state_code": "MH",
"max_weight": 0.0,
"pickup": "N",
"repl": "Y",
"covid_zone": null,
"country_code": "IN",
"is_oda": "N",
"remarks": "",
}
}
]
-> Remarks: “” -> Remarks Blank means pincode is serviceable
-> Remarks: “Embargo” -> Remarks Embargo means pincode is NSZ and its currently not serviceable (i.e Pincode is temporary NSZ )
-> Below are the fields you need to check for different service types:
"pre_paid": "Y"
"pickup": "N"
"repl": "Y"

“Y” means the mentioned service is available for the pincode.
“N” means the mentioned service is not available for the pincode.
Common Remarks :
Error Remarks	Reason	Solution
Getting the below response while trying to run the Pincode API
{
"delivery_codes": []
}
	The Pin code for which you are trying to check the serviceability does not seems to be the correct.	Pincode Please use a Valid 6 digit PIN code and try to execute the API after that.
Getting the below error while trying to execute Pincode API.	“Login or API Key Required” The Token that you are using does not seem to be the correct Token.	Please use a Valid Token shared by the Delhivery team and test after that.
Q3.How to resolve the CORS error?
CORS (Cross-Origin Resource Sharing) errors typically occur when an API is called directly from the frontend (browser), and the server does not allow requests from that origin.

To resolve this, you should avoid calling the API from the frontend. Instead, implement a backend service (wrapper) that will handle the API request securely. Your frontend should communicate with your backend, which in turn will call the external API and return the response to the frontend.

This approach not only avoids CORS issues but also enhances security and better manages authentication tokens.
FETCH WAYBILL API:
Q1.What is the Fetch Waybill API?
The Fetch Waybill API generates a list of waybills in advance. These waybills can be stored and used later in the Order Creation / Manifestation API.
Q2.What are the limitations of the Fetch Waybill API?
You can fetch a maximum of 10,000 waybills per request.
You can fetch a maximum of 50,000 waybills every 5 minutes.
If you exceed these limits, your IP address will be throttled for the next 1 minute.
Note: If you fetch more than 25 waybills, they cannot be used immediately. Store these waybills in advance in your database. Use the stored waybills later with the Manifestation API while manifesting the shipment. Attempting to use the same waybills immediately will result in an error: “Unable to consume waybill for your account.”
Common Remarks :
Error Remarks	Reason	Solution
Getting below error while trying to Execute the Fetch waybill API:“Bad Request! Invalid count for client Test”.	The Value that you are passing under the 'count' parameter does not seem to be the correct one.	Please pass the correct Integer Value for the “count” parameter in API and test after that.
Getting the error "Bad Request! Count value should be less than 10000"	This error arises when the count passed in the payload is more than 10000	Make sure the count is not more than 10,000 as the its the highest number of waybill you can fetch in one go from the bulk waybill api
CREATE & UPDATE WAREHOUSE:
Q1.Is using the Warehouse Creation API mandatory?
No, using the Warehouse Creation API is not mandatory. If you prefer not to use the API, you can contact your Delhivery Business SPOC, and they will arrange for a warehouse to be created manually by our internal team on your behalf.
Alternatively, you can create the warehouse yourself by logging into your Delhivery One Panel.
Common Remarks :
Error Remarks	Reason	Solution
Getting below Error while trying to execute the Warehouse creation API "Error in serviceability: ****** is not a valid Pincode".	This error comes when we do not pass Valid and Serviceable Pincode.	Please pass a valid 6-digit serviceable PIN code and execute the API after that.
Getting the error "warehouse does not exists"	This error comes when the the warehouse name you are passing is incorrect.	Please pass the correct warehouse name.
Getting the error "Error in serviceability: Pincode doesn't exist in system"	This pincode is not in our database system.	Please pass a valid 6 digit pincode.
Getting the error "Error in serviceability: ***** is not a valid Pincode"	This error comes when the pincode is not valid.	Please pass a valid 6 digit pincode.
Getting the error "Error due to serviceability for pincode: 100008"	The error comes when the pincode is not serviceable.	Please pass another pincode.
Pickup Request Creation API:
Q1.Is using the Pickup Request API mandatory?
Yes, submitting a pickup request is mandatory, as we need to be informed when a pickup is required. You can create a pickup request using the Pickup Request Creation API or by emailing your Business SPOC, who will arrange for the pickup request to be created manually.
If you have daily scheduled pickups, you can request your SPOC to set up an automatic pickup request on a daily basis.
Q2.Is the Pickup Request API required for reverse pickup shipments?
No, pickup requests for reverse shipments are scheduled automatically. There is no need to create pickup requests manually for reverse pickups.
Q3.What is "pickup_location" in the API payload?
In the API payload, "pickup_location" refers to the exact name of the warehouse that you have created using our Warehouse Creation API or that has been created manually through your Business SPOC.
Q4.How can we identify whether the pickup request has been completed or processed?
A pickup request is considered complete when a Field Executive (FE) arrives at the pickup location and collects the shipments. The FE will mark the pickup request as complete on their device.
Q5.Are there any available time slots provided by Delhivery for the Pickup Request Creation API?
Pickup requests should be scheduled within working hours. Each pickup request has a designated time slot (start and end time) during which the Field Executive (FE) will complete the pickup.
Common Remarks :
Error Remarks	Reason	Solution
Getting the error: A Pickup Request **** for this Pickup Location Already Exist.	This means a Pickup request is already raised in the mentioned Pickup_location.	You cannot raise another Pincup Request for a Pickup_location until the Previous PUR has been completed.
Getting the error “There has been an error but we were asked to not let you see that. Please contact the dev team.”	It seems the Token which you are trying to use is associated with your Production account Or Vice Versa.	Please use the correct token associated with the same Environment and test after that.
Getting the error "pickup_date": "Pickup date cannot be in past"	The pickup date is older than the current date.	Pickup date should be the future date.
Getting the error "Wrong/Inactive center for this warehouse"	Pickup location passed in the payload is incorrect or the pickup center associate with the warehouse name is inactive.	Pass the correct and the active warehouse name.
Getting the error "Invalid Pickup Location ClientWarehouse matching query does not exist."	Pickup location passed in the payload is incorrect or the pickup center associate with the warehouse name is inactive.	Pass the correct and the active warehouse name.
Getting the error "Pickup date should not be more than 7 days from pickup creation date"	The pickup date you passed in the payload is more than a week from the pickup creation date(date on which you are triggering the api).	Please pass the date within the next 7 days to successfully create the PUR.
Getting the error "Client is on auto pickup and please raise a ticket to firstmile_servicing@delhivery.com"	This error means that the auto pickup is enabled for your acount, you don't need to raise a pickup request.	Don't need to use the pickup request api.
Q6.Do we need to create a pickup request after creating every shipment?
No, you don’t need to create a pickup request after every shipment. Pickup requests are generated against the warehouse, not individual waybill numbers. If a pickup request has already been generated for a warehouse, the field executive (FE) will pick up all ready-to-ship orders from that location, regardless of the expected count passed in the request. However, it is recommended to provide a number close to the actual count so the FE can be prepared accordingly.
Package Slip Creation API:
Q1.Is it mandatory to use the Delhivery Package Slip API?
No, it is not mandatory to use the Delhivery Package Slip API. You can create your own package slip, but you should validate it with Delhivery to ensure that all required information is included. The API response is provided in JSON format, which you can customize and embed into HTML on your side. Additionally, Delhivery provides a Package Slip API that allows you to directly generate a shipping label in PDF format.
Q2.Do we need to create a packing slip for return items?
No, it is not required.
Q3.Does Package Slip API provide a PDF of the packing slip?
No, the API provides the response in JSON format, which you can convert into a PDF on your end. If you need a PDF label directly, you can include an additional parameter, pdf=True, in the Label API request.

Alternatively, we have an API that directly generates a PDF link for the packing slip.
-> Please refer to the API documentation below for details:
curl --location --request GET 'https://express-dev-test.delhivery.com/api/p/packing_slip?wbns=xxxxxxxxxxx&pdf=True'
--header 'Authorization: Token xxxxxxxxxxxxxxxxxx'
--header 'Content-Type: application/json'
Common Remarks :
Error Remarks	Reason	Solution
Getting below error while trying to Execute the Package SLIP API.

{
"packages": [],
"packages_found": 0
}
	This means the Waybill that you are using is Incorrect OR has not been Manifested Yet.	Please pass a valid Manifested Waybill under “wbns” field and execute the API after that.
Q4.Can we fetch multiple labels in a single request?
No, each label must be fetched through a separate API request. The system does not support retrieving multiple labels in a single request.
TRACK SHIPMENT API:
Q1.How can we track our order?
You can track your order using the Order Tracking API. This will be a pull request.
Q2.Can multiple AWBs be tracked in a single API request?
Yes, you can track multiple AWBs in a single API request. You can pass up to 50 waybills (comma-separated) in one request. Additionally, you can make up to 750 requests per 5 minutes. Therefore, in 5 minutes, you can track up to 50 * 750 = 37,500 shipments.
Q3.Is there any other way to get the tracking information?
Yes, you can avail our Scan Push (Webhook) feature. You will need to provide your API endpoint, header if any and we will push each scan detail to the endpoint you specify.
Common Remarks :
Error Remarks	Reason	Solution
Getting the error "Data does not exists for provided Waybill(s)" while trying to execute the Tracking API.	This means the waybill you are trying to track has not been manifested yet or is not associated with the account whose token you are using in this API.	Please use a valid waybill manifested from the same account.
Getting the error “No such waybill or order ID found”.	This error comes when you do not use Waybill and Token generated from the same account.	Please use Token and Waybill generated from the same account and test after that.
Getting the Error "403 Forbidden"	This error comes when the ip you are using to track the shipment has been blocked due to the violation of the rate limit.	Pause sending requests and wait for at least 30 seconds until the AWS WAF check runs again.

Ensure your request rate stays below 750 requests in any 5-minute window by implementing throttling or batching to avoid future 403 errors.
TAKE NDR ACTION API:
Q1.Can we use the NDR Edit API to update the details?
Please avoid using the NDR API to edit or update shipment details. Instead, use the Edit API of Manifestation to update the shipment details.
Common Remarks :
Error Remarks	Reason	Solution
Getting the error “Package in incorrect status” while trying to check the Status using NDR Status API	This means you are trying to apply the NDR on the shipment that is not in correct Status.	To Apply NDR Reattempt the package should be in below status:

"RE-ATTEMPT" action can be taken on the AWB if AWB is in Pending State and also the current NSL code for the shipment is in the given list ["EOD-74", "EOD-15", "EOD-104", "EOD-43", "EOD-86", "EOD-11", "EOD-69","EOD-6"].

Invalid data provided	The "data" field in the payload is not in list format.	Ensure the payload format is correct. Refer to the API Postman collection for the correct payload structure.
Can not update more than 1000 records	The "data" list contains more than 1000 items.	A maximum of 1000 shipments can be updated in a single API call. Split the request into multiple calls if needed.
Unauthorized client/user	The user is not authorized.	Verify that you are using the correct authorization token.
Package action is being performed	The request is currently being processed.	The request is in progress. Please check again after some time.
Action is not valid	The "act" field does not contain "PICKUP_RESCHEDULE".	Ensure that the action is set to "PICKUP_RESCHEDULE" in the request payload.
"waybill" is missing	The "waybill" field is missing in the "data" payload.	The "waybill" key is mandatory. Include it in the payload before making the request.
Package should be in Canceled status	"PICKUP_RESCHEDULE" is allowed only for canceled shipments.	The package status should be CN and the shipment status should be "Canceled" while applying "PICKUP_RESCHEDULE".
Shipment has reached max attempt count	"PICKUP_RESCHEDULE" is allowed only if the shipment attempt count is 1 or 2.	Contact your Delhivery account POC if "PICKUP_RESCHEDULE" is required for this shipment.
Incorrect waybill	The provided waybill does not match the client’s account.	Verify that the waybill is correct before applying "PICKUP_RESCHEDULE".
Package is part of dispatch. Cannot update the information now	"PICKUP_RESCHEDULE" is not allowed as the shipment is part of an open dispatch.	Try again later or contact your Delhivery account POC to process "PICKUP_RESCHEDULE" for this shipment.
Rescheduling is not allowed as <Reason>	The package does not meet the conditions for a "PICKUP_RESCHEDULE" request.	"PICKUP_RESCHEDULE" is allowed only when the package has the current NSL as "EOD-777 (RVP QC Fail)" or "EOD-21 (Pickup request canceled)", where "EOD-21" must be non-OTP verified.
CALCULATE SHIPPING COST API:
Q1.Why am I getting 0 amount in the staging environment while using the Invoice shipping charge API?
Since we do not store the charges in our staging environment, hence no charges would come in the response. It is recommended to use the Invoice shipping charge API directly in the production environment to view the charges.
Q2.Why am I getting 0 amount in the production environment while using the Invoice Shipping charge API even though all the parameters are passed correctly?
Please pass an additional parameter in the API, “pt” where the payment mode will be passed. It can be either “Pre-paid” or “COD”. Refer to the sample curl:

curl --location --request GET 'https://track.delhivery.com/api/kinko/v1/invoice/charges/.json?md=S&ss=Delivered&d_pin=122002&o_pin=110017&cgm=1500&pt=Pre-paid' \
--header 'Authorization: Token xxxxxxxxxxxxxxxxxxxxxxx'
Common Remarks :
Error Remarks	Reason	Solution
Getting the "error": "Unable to process request for provided o_pin"	The error comes when you have passed the incorrect o_pin	Please pass a valid o_pin
Getting the "error": "ss is mandatory field and possible values can be Delivered,RTO,DTO"	The error comes when you have passed the incorrect value for ss	Please pass a valid value for ss and the possible values are Delivered,RTO,DTO
Getting the "error": "md is mandatory field and possible values can be S,E"	The error comes when you have passed the incorrect value for md	Please pass a valid value for md and the possible values are S,E
Getting the "error": "Unable to process request, Please contact: lastmile-integration@delhivery.com"	The error comes when you have passed the incorrect d_pin	Please pass a valid d_pin
Webhook Integration:
Q1.How to identify whether a shipment is moving forward or in reverse?
You can determine the shipment direction using the ""ScanType"" field in the tracking data.

-->UD (Undelivered) indicates that the shipment is moving in the forward direction.
-->RT (Return) indicates that the shipment is moving in the reverse direction.
Q2.What is NSL?
NSL stands for Net Service Level. It is a unique alphanumeric code assigned to each status applied to a shipment, helping you track the shipment at a more granular level.

Since there can be multiple NSLs representing similar states (e.g., 10 different NSLs for "in transit"), exposing all of them to end customers may create confusion. It’s recommended to create your own simplified status mapping—grouping similar NSLs under broader categories like "In Transit", "Out for Delivery" , etc.—to ensure a cleaner and more understandable tracking experience for your users.
Q3.What is the significance of each key in the default payload?
"Shipment": {

"Status: "{

"Status": "Manifested",
// Current status of the shipment
"StatusDateTime": "2019-01-09T17:10:42.767",
// Timestamp when the status was marked
"StatusType": "UD",
// Type of status (e.g., UD = forward, RT = reverse)
"StatusLocation": "Chandigarh_Raiprkln_C (Chandigarh)",
// Location where the status was updated
"Instructions": "Manifest uploaded"
// Description or remark associated with the NSL
},
"PickUpDate": "2019-01-09 17:10:42.543",
// Scheduled pickup date of the shipment
"NSLCode": "X-UCI",
// NSL (Net Service Level) code applied to the shipment
"Sortcode": "IXC/MDP",
// Internal sorting code (can be ignored)
"ReferenceNo": "28",
// Order ID provided at the time of order creation
"AWB": "XXXXXXXXXXXX"
// Air Waybill (AWB) number assigned to the shipment
}
Q4.Can a missed scan be re-pushed?
In case a scan push fails, the system automatically retries immediately. If the retry also fails, that particular scan cannot be pushed again manually. However, when the shipment progresses and a new status update occurs, the latest scan will be pushed.

For any missed scans, you will need to use the Track API to retrieve the current status, as manual re-push is not supported. This applies for all the webhooks ( EPOD, Sorter Image, QC Images & LM_POD ).
API Integration Related General FAQ's:
Q1.Does the authorization token for any API provided ever expire? How/when do we get one for the production environment?
The authorization token is static and does not expire. This token is for a lifetime. For the production environment, you will get a separate authorization token, once your testing phase gets completed. The process will remain the same for getting the live Token key. You need to reach out to your business SPOC once testing is done successfully
Q2.Are the tokens the same across all APIs (Package order creation, order tracking API, packing Slip API)?
Yes, the token remains constant for all API's, till there is a switch in environments (Testing/Production) as the token will be different for testing and production environment
Q3.Do we need to perform a check for the serviceability API before we call the Package Order creation API?
Yes, this is a mandatory and recommended task for every shipment for Delhivery. So if the pin-code is not serviceable then there is no point in creating order in our system as that will be marked as NSZ-Non serviceable and will be returned back.
Q4.We have very few orders say 500-1000 per day so instead of integrating through API's can we ship any other way and use all API service through any frontend?**
Yes, we have a Client panel (name as Delhivery one Panel) where the clients can log-in and create packages in single/bulk fashion in one go. They can track the shipments, generate packing slip, see COD remittance details so all API tasks can be done directly through the front-end.
Please refer below URL to Login Into the Delhivery One Panel:
https://one.delhivery.com/login
Q5.What is the use of pickup location? If I have multiple sellers across, how can I get pickup locations created against all the sellers?
The pickup location, in other words, is a warehouse name. This holds the details of the warehouse (pickup location) from where the order has to be picked up. In order to do that, you have to register the seller details and our team will store those details against your client ID and will share a pickup location against that. Once registered you can use that pick-up location while creating an order.
Q6.Created a shipment through the API Playground, but I am unable to track it using my staging token. Why is that?
The API Playground operates within a separate staging environment, and you can create as many test shipments as needed there. However, please note that any shipment created through the Playground is intended to be tracked within the Playground itself.

Tracking these shipments using your own staging token may not work, as the staging account configured in the API Playground could be different from the one provided to you by the Business Development (BD) team.
IMPORTANT NOTE:
Kindly reach out to < lastmile-integration@delhivery.com > for API-related queries and keep your Delhivery business account POC in the loop.
Connect with your respective Delhivery business account POC for Account , Billing, OR Operation related queries.
