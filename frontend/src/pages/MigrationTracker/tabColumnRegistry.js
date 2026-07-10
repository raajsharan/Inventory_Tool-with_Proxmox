/**
 * Defines the configurable columns for each VM tab type.
 * The "vm" (VM Name) column is always shown and not configurable.
 * CUSTOM_COLUMNS is the superset used by user-created custom tabs.
 */

// All possible columns for user-created custom tabs
export const CUSTOM_COLUMNS = [
  { key: 'migration_status',        label: 'Status'       },
  { key: 'powerstate',              label: 'Power'        },
  { key: 'guest_state',             label: 'Guest State'  },
  { key: 'primary_ip',              label: 'Primary IP'   },
  { key: 'mac_address',             label: 'MAC Address'  },
  { key: 'dns_name',                label: 'DNS Name'     },
  { key: 'host',                    label: 'Host'         },
  { key: 'cpus',                    label: 'CPUs'         },
  { key: 'memory_mib',              label: 'Memory'       },
  { key: 'total_disk_capacity_mib', label: 'Disk'         },
  { key: 'nics',                    label: 'NICs'         },
  { key: 'disks',                   label: 'Disks'        },
  { key: 'os_config',               label: 'OS (config)'  },
  { key: 'os_tools',                label: 'OS (tools)'   },
  { key: 'datacenter',              label: 'Datacenter'   },
  { key: 'cluster',                 label: 'Cluster'      },
  { key: 'path',                    label: 'Path'         },
];

export const TAB_DEFAULTS = {
  bomgar_vms:      { key: 'bomgar_vms',      label: 'Bomgar VMs',      icon: 'DesktopOutlined'  },
  security_vms:    { key: 'security_vms',    label: 'Security VMs',    icon: 'SafetyOutlined'   },
  standalone_esxi: { key: 'standalone_esxi', label: 'Standalone ESXi', icon: 'ClusterOutlined'  },
};

export const TAB_KEYS = ['bomgar_vms', 'security_vms', 'standalone_esxi'];

export const COLUMN_REGISTRY = {
  bomgar_vms: [
    { key: 'migration_status',        label: 'Status'       },
    { key: 'powerstate',              label: 'Power'        },
    { key: 'dns_name',                label: 'DNS Name'     },
    { key: 'primary_ip',              label: 'Primary IP'   },
    { key: 'cpus',                    label: 'CPUs'         },
    { key: 'memory_mib',              label: 'Memory'       },
    { key: 'total_disk_capacity_mib', label: 'Disk'         },
    { key: 'nics',                    label: 'NICs'         },
    { key: 'disks',                   label: 'Disks'        },
    { key: 'os',                      label: 'OS Family'    },
    { key: 'os_config',               label: 'OS (config)'  },
    { key: 'os_tools',                label: 'OS (tools)'   },
    { key: 'datacenter',              label: 'Datacenter'   },
    { key: 'cluster',                 label: 'Cluster'      },
    { key: 'host',                    label: 'Host'         },
    { key: 'path',                    label: 'Path'         },
  ],
  security_vms: [
    { key: 'migration_status',        label: 'Status'       },
    { key: 'powerstate',              label: 'Power'        },
    { key: 'guest_state',             label: 'Guest State'  },
    { key: 'primary_ip',              label: 'Primary IP'   },
    { key: 'mac_address',             label: 'MAC Address'  },
    { key: 'host',                    label: 'Host'         },
    { key: 'cpus',                    label: 'CPUs'         },
    { key: 'memory_mib',              label: 'Memory'       },
    { key: 'total_disk_capacity_mib', label: 'Disk'         },
    { key: 'nics',                    label: 'NICs'         },
    { key: 'disks',                   label: 'Disks'        },
    { key: 'os_config',               label: 'OS (config)'  },
    { key: 'os_tools',                label: 'OS (tools)'   },
  ],
  standalone_esxi: [
    { key: 'migration_status',        label: 'Status'       },
    { key: 'powerstate',              label: 'Power'        },
    { key: 'guest_state',             label: 'Guest State'  },
    { key: 'primary_ip',              label: 'Primary IP'   },
    { key: 'mac_address',             label: 'MAC Address'  },
    { key: 'host',                    label: 'Host'         },
    { key: 'cpus',                    label: 'CPUs'         },
    { key: 'memory_mib',              label: 'Memory'       },
    { key: 'total_disk_capacity_mib', label: 'Disk'         },
    { key: 'nics',                    label: 'NICs'         },
    { key: 'disks',                   label: 'Disks'        },
    { key: 'os_config',               label: 'OS (config)'  },
    { key: 'os_tools',                label: 'OS (tools)'   },
  ],
};
