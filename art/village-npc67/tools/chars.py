"""Stage 6.7 NPC 設定：檔名、遊戲代號、目標身高（頭頂，不含帽子／武器）、原始模型頭頂高度。"""
CHARS = {
    "N001_SwordsmanInstructor.glb": dict(key="swordmaster", head_top=0.975, target=1.36),
    "N002_Knight_Commander.glb":    dict(key="knight",      head_top=0.975, target=1.38),
    "N003_Blacksmith_Master.glb":   dict(key="smith",       head_top=0.965, target=1.32),
    "N004_Mage_Commander.glb":      dict(key="mage",        head_top=0.860, target=1.30),
    "N005_High_Priestess.glb":      dict(key="priest",      head_top=0.900, target=1.30),
    "N006_Jester_Master.glb":       dict(key="clown",       head_top=0.880, target=1.32),
    "N007_WarehouseKeeper_Female.glb": dict(key="warehouse", head_top=0.950, target=1.30),
    "N009_PetKeeper_Male_V2.glb":   dict(key="merchant",    head_top=0.950, target=1.32),
    "N008_QuestBoard.glb":          dict(key="board",       width=3.2),
}
