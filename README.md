# spinal-organ-connector-merciyanis
Simple BOS-MERCIYANIS api connector to sync ticket events

https://merciyanis.notion.site/webhooks


https://merciyanis.notion.site/rest-api

## Getting Started

These instructions will guide you on how to install and make use of the spinal-organ-connector-merciyanis.

### Prerequisites

This module requires a `.env` file in the root directory with the following variables:

```bash
SPINAL_USER_ID=                             # The id of the user connecting to the spinalhub
SPINAL_PASSWORD=                            # The password of the user connecting to the spinalhub
SPINALHUB_IP=                               # The IP address of the spinalhub
SPINALHUB_PROTOCOL=                         # The protocol for connecting to the spinalhub (http or https)
SPINALHUB_PORT=                             # The port for connecting to the spinalhub
DIGITALTWIN_PATH=                           # The path of the digital twin in the spinalhub
SPINAL_ORGAN_NAME=                          # The name of the organ
SPINAL_CONFIG_PATH=                         # The path of the config file in the spinalhub exemple : /etc/Organs/{OrganName}
```


### Installation

Clone this repository in the directory of your choice. Navigate to the cloned directory and install the dependencies using the following command:
    
```bash
spinalcom-utils i
```

To build the module, run:

```bash
npm run build
```

### Usage

Start the module with:

```bash
npm run start
```

Or using [pm2](https://pm2.keymetrics.io/docs/usage/quick-start/)
```bash
pm2 start index.js --name organ-connector-merciyanis
```


### Sequence Diagram — Mission <-> Mission Connector <-> Spinal <-> MerciYanis Connector <-> MerciYanis

```mermaid
sequenceDiagram
    participant Mission
    participant MissionConnector as Mission Connector
    participant Spinal
    participant MYConnector as MerciYanis Connector
    participant MerciYanis

    %% --- Initialization phase ---
    Note over MYConnector: Startup phase
    MYConnector->>Spinal: Connect to SpinalHub
    MYConnector->>MerciYanis: Check access_token validity
    alt Token expired
        MYConnector->>MerciYanis: Refresh access_token (using refresh_token)
    end
    MYConnector->>MYConnector: Start webhook server
    MYConnector->>MerciYanis: Pull all tickets
    MYConnector->>Spinal: Create missing tickets in Spinal

    %% --- Webhook: Ticket creation ---
    Note over MerciYanis,MYConnector: Webhook create event received
    MerciYanis-->>MYConnector: Webhook (ticket created)
    MYConnector->>Spinal: Create new ticket node
    alt Ticket ≠ "Comptage de passage"
        Spinal->>MissionConnector: Notify new ticket
        MissionConnector->>Mission: Create corresponding ticket
        Mission-->>MissionConnector: Return gmaoId
        MissionConnector->>Spinal: Update ticket with gmaoId
    else Ticket = "Comptage de passage"
        Note right of MYConnector: No Mission sync needed
    end

    %% --- Webhook: Ticket update (Comptage de passage only) ---
    Note over MerciYanis,MYConnector: Webhook update event
    MerciYanis-->>MYConnector: Webhook (ticket updated)
    MYConnector->>Spinal: Update ticket status (Comptage de passage only)

    %% --- Regular sync check ---
    Note over MYConnector: Periodic sync
    MYConnector->>MerciYanis: Pull all tickets
    MYConnector->>Spinal: Compare statuses
    alt Spinal ticket status is more advanced
        MYConnector->>MerciYanis: Update ticket status in MerciYanis
    end

    %% --- Mission update propagation ---
    Note over MissionConnector: Mission updates ticket
    Mission->>MissionConnector: Update ticket status
    MissionConnector->>Spinal: Update corresponding Spinal ticket
    Spinal->>MYConnector: Notify status change
    MYConnector->>MerciYanis: Update MerciYanis ticket
    

```


```