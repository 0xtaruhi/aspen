export const DEVICE_GRID_PX = 20
export const BASE_DEVICE_HEADER_HEIGHT_PX = 40
export const BASE_DEVICE_CONTENT_PADDING_PX = 8

export const MATRIX_CELL_SIZE_PX = 14
export const MATRIX_CELL_GAP_PX = 4
export const MATRIX_OUTER_PADDING_PX = 8
export const MATRIX_GRID_PADDING_PX = 12

export function alignShellSize(value: number) {
  return Math.ceil(value / DEVICE_GRID_PX) * DEVICE_GRID_PX
}

export function measureMatrixShellSize(columns: number, rows: number) {
  const gridWidth = columns * MATRIX_CELL_SIZE_PX + Math.max(0, columns - 1) * MATRIX_CELL_GAP_PX
  const gridHeight = rows * MATRIX_CELL_SIZE_PX + Math.max(0, rows - 1) * MATRIX_CELL_GAP_PX

  const contentWidth = MATRIX_OUTER_PADDING_PX * 2 + MATRIX_GRID_PADDING_PX * 2 + gridWidth
  const contentHeight = MATRIX_OUTER_PADDING_PX * 2 + MATRIX_GRID_PADDING_PX * 2 + gridHeight

  return {
    width: alignShellSize(BASE_DEVICE_CONTENT_PADDING_PX * 2 + contentWidth),
    height: alignShellSize(
      BASE_DEVICE_HEADER_HEIGHT_PX + BASE_DEVICE_CONTENT_PADDING_PX * 2 + contentHeight,
    ),
  }
}
