#!/usr/bin/env python3
"""Collect Hyper-V host + VM details over WMI/DCOM (impacket).

Called by the backend test route. The password is read from the
HYPERV_WIN_PASSWORD environment variable (never argv, so it doesn't show up in
process listings). Prints one JSON document to stdout; on failure prints
{"error": "..."} and exits 1.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

from impacket.dcerpc.v5.dcomrt import DCOMConnection
from impacket.dcerpc.v5.dcom import wmi


def query(service, sql):
    enum = service.ExecQuery(sql)
    results = []

    while True:
        try:
            objects = enum.Next(0xFFFFFFFF, 1)

            for obj in objects:
                properties = obj.getProperties()
                results.append({
                    k: v.get("value")
                    for k, v in properties.items()
                })

        except Exception as e:
            if "S_FALSE" in str(e):
                break
            raise

    return results


def namespace(dcom, path):
    interface = dcom.CoCreateInstanceEx(
        wmi.CLSID_WbemLevel1Login,
        wmi.IID_IWbemLevel1Login
    )

    login = wmi.IWbemLevel1Login(interface)
    service = login.NTLMLogin(path, wmi.NULL, wmi.NULL)
    login.RemRelease()

    return service


def collect(host, username, password, domain):
    dcom = DCOMConnection(host, username, password, domain)

    try:
        root = namespace(dcom, "//./root/cimv2")
        hyperv = namespace(dcom, "//./root/virtualization/v2")

        system = query(root, "SELECT * FROM Win32_ComputerSystem")[0]
        os_info = query(root, "SELECT * FROM Win32_OperatingSystem")[0]
        bios = query(root, "SELECT * FROM Win32_BIOS")[0]
        cpu = query(root, "SELECT * FROM Win32_Processor")
        disks = query(root, "SELECT * FROM Win32_LogicalDisk WHERE DriveType=3")
        vms = query(
            hyperv,
            "SELECT * FROM Msvm_ComputerSystem WHERE Caption='Virtual Machine'"
        )

        total_ram = int(os_info["TotalVisibleMemorySize"]) / 1048576
        free_ram = int(os_info["FreePhysicalMemory"]) / 1048576

        disk_info = []
        for disk in disks:
            size = int(disk["Size"] or 0)
            free = int(disk["FreeSpace"] or 0)
            disk_info.append({
                "Drive": disk["DeviceID"],
                "TotalGB": round(size / 1073741824, 2),
                "FreeGB": round(free / 1073741824, 2),
                "UsedPercent": round((size - free) / size * 100, 2) if size else 0
            })

        vm_info = [{
            "VMName": vm["ElementName"],
            "VMID": vm["Name"],
            "State": vm["EnabledState"]
        } for vm in vms]

        return {
            "CollectionTime": datetime.now(timezone.utc).isoformat(),
            "Host": {
                "IPAddress": host,
                "Hostname": system["Name"],
                "Manufacturer": system["Manufacturer"],
                "Model": system["Model"],
                "SerialNumber": bios["SerialNumber"],
                "OS": os_info["Caption"],
                "OSVersion": os_info["Version"],
                "CPU": cpu[0]["Name"] if cpu else None,
                "CPUCount": system["NumberOfLogicalProcessors"],
                "RAMTotalGB": round(total_ram, 2),
                "RAMUsedPercent": round(
                    (total_ram - free_ram) / total_ram * 100, 2
                ) if total_ram else 0,
                "Disks": disk_info
            },
            "VMCount": len(vm_info),
            "VMs": vm_info
        }

    finally:
        dcom.disconnect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--user", default="Administrator")
    parser.add_argument("--domain", default="")
    args = parser.parse_args()

    try:
        data = collect(args.host, args.user, os.environ.get("HYPERV_WIN_PASSWORD", ""), args.domain)
        print(json.dumps(data, indent=2, default=str))
    except Exception as e:  # report as JSON so the caller can show it
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)
