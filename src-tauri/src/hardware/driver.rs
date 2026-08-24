use std::path::Path;

use super::types::{HardwareBoardInfoV1, HardwareBoardSelectorV1, HardwareDeviceSnapshot};
use vlfd_rs::{Board, BoardSelector, Programmer, UsbLocation};

pub fn list_boards() -> Result<Vec<HardwareBoardInfoV1>, String> {
    Board::enumerate()
        .map(|boards| boards.into_iter().map(Into::into).collect())
        .map_err(|err| err.to_string())
}

pub fn probe_device(selector: &HardwareBoardSelectorV1) -> Result<HardwareDeviceSnapshot, String> {
    let board = Board::open_selected(&board_selector(selector)?).map_err(|err| err.to_string())?;
    let snapshot = board.config().clone().into();
    let _ = board.close();

    Ok(HardwareDeviceSnapshot {
        board: "FDP3P7".to_string(),
        description: "VLFD FPGA board (FDP3P7)".to_string(),
        config: snapshot,
    })
}

pub fn program_bitstream(
    selector: &HardwareBoardSelectorV1,
    bitstream_path: &str,
) -> Result<(), String> {
    let mut programmer =
        Programmer::open_selected(&board_selector(selector)?).map_err(|err| err.to_string())?;
    let result = programmer
        .program(Path::new(bitstream_path))
        .map_err(|err| err.to_string());
    let _ = programmer.close();
    result
}

pub fn board_selector(selector: &HardwareBoardSelectorV1) -> Result<BoardSelector, String> {
    match selector {
        HardwareBoardSelectorV1::Only => Ok(BoardSelector::Only),
        HardwareBoardSelectorV1::SerialNumber { serial_number } => {
            let serial_number = serial_number.trim();
            if serial_number.is_empty() {
                return Err("board serial number cannot be empty".to_string());
            }
            Ok(BoardSelector::SerialNumber(serial_number.to_string()))
        }
        HardwareBoardSelectorV1::UsbLocation { bus_id, port_chain } => {
            let bus_id = bus_id.trim();
            if bus_id.is_empty() || port_chain.is_empty() {
                return Err("board USB location requires a bus and port chain".to_string());
            }
            Ok(BoardSelector::UsbLocation(UsbLocation {
                bus_id: bus_id.to_string(),
                port_chain: port_chain.clone(),
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_serial_and_usb_board_selectors() {
        assert_eq!(
            board_selector(&HardwareBoardSelectorV1::SerialNumber {
                serial_number: " board-1 ".to_string(),
            })
            .unwrap(),
            BoardSelector::SerialNumber("board-1".to_string())
        );
        assert_eq!(
            board_selector(&HardwareBoardSelectorV1::UsbLocation {
                bus_id: "usb-0".to_string(),
                port_chain: vec![2, 3],
            })
            .unwrap(),
            BoardSelector::UsbLocation(UsbLocation {
                bus_id: "usb-0".to_string(),
                port_chain: vec![2, 3],
            })
        );
    }

    #[test]
    fn rejects_incomplete_board_selectors() {
        assert!(board_selector(&HardwareBoardSelectorV1::SerialNumber {
            serial_number: " ".to_string(),
        })
        .is_err());
        assert!(board_selector(&HardwareBoardSelectorV1::UsbLocation {
            bus_id: "usb-0".to_string(),
            port_chain: vec![],
        })
        .is_err());
    }
}
