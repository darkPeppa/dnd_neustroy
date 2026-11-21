package ru.neustroy

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.input.KeyboardType

@Composable
fun NumberInput(
    label: String,
    value: Double,
    min: Double = -1000000.0,
    max: Double = 1000000.0,
    whole: Boolean = false,
    change: (Double) -> Unit,
) {
    fun display(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()
    var raw by remember { mutableStateOf(display(value)) }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(value) { if (!focused) raw = display(value) }
    val valid =
        raw.toDoubleOrNull()?.let {
            it.isFinite() && it in min..max && (!whole || it % 1.0 == 0.0)
        } == true
    OutlinedTextField(
        raw,
        {
            raw = it
            val number = it.toDoubleOrNull()
            if (
                number != null &&
                    number.isFinite() &&
                    number in min..max &&
                    (!whole || number % 1.0 == 0.0)
            )
                change(number)
        },
        label = { Text(label) },
        singleLine = true,
        isError = raw.isNotBlank() && !valid,
        keyboardOptions =
            KeyboardOptions(
                keyboardType = if (whole) KeyboardType.Number else KeyboardType.Decimal
            ),
        modifier =
            Modifier.fillMaxWidth().onFocusChanged {
                focused = it.isFocused
                if (!it.isFocused && !valid) raw = display(value)
            },
    )
}

fun characterText(c: Character) = buildString {
    appendLine("${c.name} · ${c.info.name} ${c.level} · ${editions[c.edition]}")
    appendLine("${c.ancestry} · ${c.background}")
    appendLine("Хиты ${c.hp}/${c.maxHp} · КД ${c.ac} · Владение ${signed(c.proficiency)}")
    statLabels.forEach { (id, label) ->
        appendLine("$label: ${c.scores[id]} (${signed(c.modifier(id))})")
    }
    appendLine("\nНавыки")
    skills.forEach { (id, skill) -> appendLine("${skill.first}: ${signed(c.skillBonus(id))}") }
    appendLine("\nПодготовленные заклинания\n${c.prepared.joinToString("\n")}")
    appendLine("\nСнаряжение\n${c.inventory}")
    appendLine("\nИстория\n${c.notes}")
}
